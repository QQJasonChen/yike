import Capacitor
import Foundation
import HealthKit

// Apple 健康讀取：Garmin Connect 開「Apple 健康」同步後，資料會流進這裡。
// JS 端：src/healthKit.ts；組裝：docs/GARMIN-SETUP.md（Xcode 要加 HealthKit capability）
// 只讀不寫；回傳每天一筆彙總，欄位名對齊 src/health.ts 的 HealthMetrics。
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryDays", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    // 累加型（一天加總）：JS 欄位名 → 型別、單位
    private lazy var cumulative: [(String, HKQuantityTypeIdentifier, HKUnit)] = [
        ("steps", .stepCount, .count()),
        ("distanceM", .distanceWalkingRunning, .meter()),
        ("floors", .flightsClimbed, .count()),
        ("activeKcal", .activeEnergyBurned, .kilocalorie()),
        ("intensityMin", .appleExerciseTime, .minute()),
    ]

    // 平均型（一天平均）
    private lazy var averaged: [(String, HKQuantityTypeIdentifier, HKUnit)] = [
        ("restingHr", .restingHeartRate, HKUnit.count().unitDivided(by: .minute())),
        ("avgHr", .heartRate, HKUnit.count().unitDivided(by: .minute())),
        ("hrv", .heartRateVariabilitySDNN, .secondUnit(with: .milli)),
        ("spo2Avg", .oxygenSaturation, .percent()),
        ("respirationAvg", .respiratoryRate, HKUnit.count().unitDivided(by: .minute())),
    ]

    // 取當天最後一筆
    private lazy var latest: [(String, HKQuantityTypeIdentifier, HKUnit)] = [
        ("weightKg", .bodyMass, .gramUnit(with: .kilo)),
        ("vo2max", .vo2Max, HKUnit(from: "ml/kg*min")),
    ]

    private func readTypes() -> Set<HKObjectType> {
        var s = Set<HKObjectType>()
        for (_, id, _) in cumulative + averaged + latest {
            if let t = HKObjectType.quantityType(forIdentifier: id) { s.insert(t) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { s.insert(sleep) }
        return s
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false, "error": "這台裝置沒有 Apple 健康"])
            return
        }
        // 讀取權限 Apple 不告訴 app 使用者是否拒絕（隱私設計）；能跑完授權流程就算成功，
        // 真的被拒時查詢只會回空資料。
        store.requestAuthorization(toShare: nil, read: readTypes()) { ok, err in
            if let err = err {
                call.resolve(["granted": false, "error": err.localizedDescription])
            } else {
                call.resolve(["granted": ok])
            }
        }
    }

    private static let dayFmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let hmFmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "HH:mm"
        return f
    }()

    @objc func queryDays(_ call: CAPPluginCall) {
        let days = max(1, min(call.getInt("days") ?? 30, 365))
        let cal = Calendar.current
        let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Date()))!
        let start = cal.date(byAdding: .day, value: -days, to: end)!
        let anchor = cal.startOfDay(for: start)
        let interval = DateComponents(day: 1)

        var result: [String: [String: Any]] = [:]
        let lock = NSLock()
        let group = DispatchGroup()

        func put(_ date: Date, _ key: String, _ value: Any) {
            let k = Self.dayFmt.string(from: date)
            lock.lock()
            var row = result[k] ?? ["date": k]
            row[key] = value
            result[k] = row
            lock.unlock()
        }

        func collect(_ id: HKQuantityTypeIdentifier, _ options: HKStatisticsOptions,
                     _ each: @escaping (HKStatistics) -> Void) {
            guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: pred,
                                                options: options, anchorDate: anchor,
                                                intervalComponents: interval)
            q.initialResultsHandler = { _, coll, _ in
                coll?.enumerateStatistics(from: start, to: end) { stats, _ in each(stats) }
                group.leave()
            }
            store.execute(q)
        }

        for (key, id, unit) in cumulative {
            collect(id, .cumulativeSum) { s in
                if let v = s.sumQuantity()?.doubleValue(for: unit), v > 0 { put(s.startDate, key, v) }
            }
        }
        for (key, id, unit) in averaged {
            collect(id, .discreteAverage) { s in
                guard var v = s.averageQuantity()?.doubleValue(for: unit) else { return }
                if key == "spo2Avg" { v *= 100 } // HealthKit 的百分比是 0–1
                put(s.startDate, key, v)
            }
        }
        for (key, id, unit) in latest {
            collect(id, .mostRecent) { s in
                if let v = s.mostRecentQuantity()?.doubleValue(for: unit) { put(s.startDate, key, v) }
            }
        }

        // 睡眠：歸到「醒來那天」（跟 Garmin 的 calendarDate 慣例一致）。
        // 同時戴 Apple Watch 和 Garmin 時兩個來源會重疊——每天只取「睡最久的那個來源」，避免重複加總。
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            group.enter()
            // 往前多抓 12 小時，前一晚入睡的那段才會進來
            let sleepStart = start.addingTimeInterval(-12 * 3600)
            let pred = HKQuery.predicateForSamples(withStart: sleepStart, end: end, options: [])
            let q = HKSampleQuery(sampleType: sleepType, predicate: pred, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: nil) { _, samples, _ in
                struct Agg {
                    var deep = 0.0, rem = 0.0, core = 0.0, unspecified = 0.0, awake = 0.0
                    var bed: Date? = nil, wake: Date? = nil
                    var asleep: Double { deep + rem + core + unspecified }
                }
                var byDaySource: [String: [String: Agg]] = [:]
                for case let s as HKCategorySample in samples ?? [] {
                    let day = Self.dayFmt.string(from: s.endDate)
                    let src = s.sourceRevision.source.bundleIdentifier
                    var a = byDaySource[day]?[src] ?? Agg()
                    let dur = s.endDate.timeIntervalSince(s.startDate)
                    guard let kind = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
                    switch kind {
                    case .asleepDeep: a.deep += dur
                    case .asleepREM: a.rem += dur
                    case .asleepCore: a.core += dur
                    case .asleepUnspecified: a.unspecified += dur
                    case .awake: a.awake += dur
                    default: continue // inBed 不算睡著
                    }
                    if a.bed == nil || s.startDate < a.bed! { a.bed = s.startDate }
                    if a.wake == nil || s.endDate > a.wake! { a.wake = s.endDate }
                    byDaySource[day, default: [:]][src] = a
                }
                for (day, sources) in byDaySource {
                    guard let best = sources.values.max(by: { $0.asleep < $1.asleep }), best.asleep > 0,
                          let date = Self.dayFmt.date(from: day) else { continue }
                    put(date, "sleepSec", best.asleep)
                    if best.deep > 0 { put(date, "deepSec", best.deep) }
                    if best.rem > 0 { put(date, "remSec", best.rem) }
                    if best.core > 0 { put(date, "lightSec", best.core) }
                    if best.awake > 0 { put(date, "awakeSec", best.awake) }
                    if let b = best.bed { put(date, "bedtime", Self.hmFmt.string(from: b)) }
                    if let w = best.wake { put(date, "wakeTime", Self.hmFmt.string(from: w)) }
                }
                group.leave()
            }
            store.execute(q)
        }

        group.notify(queue: .main) {
            let rows = result.values.sorted { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") }
            call.resolve(["days": rows])
        }
    }
}

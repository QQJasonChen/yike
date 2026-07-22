import Foundation
import SwiftUI
import WidgetKit

// 快照 schema：跟 src/widgetSync.ts 的 WidgetSnapshot 一一對應（那邊改、這邊要跟著改）。
struct WTask: Codable {
    let text: String
    let done: Int
    let target: Int?
    let completed: Bool
}

struct WBlock: Codable {
    let start: Int // 從 00:00 起算的分鐘
    let end: Int
    let text: String
    let color: String // hex，如 "#b8923e"
}

struct WDay: Codable {
    let date: String
    let weekday: String
    let mit: String
    let mitDone: Bool
    let blockCount: Int
}

struct WidgetSnapshot: Codable {
    let date: String
    let mit: String
    let mitDone: Bool
    let tasks: [WTask]
    let blocks: [WBlock]
    let streak: Int
    let week: [WDay]
}

// 紙感色票（對齊 app）
enum Paper {
    static let bg = Color(red: 0.961, green: 0.941, blue: 0.902) // #F5F0E6
    static let card = Color(red: 0.984, green: 0.973, blue: 0.945)
    static let ink = Color(red: 0.169, green: 0.149, blue: 0.125) // #2B2620
    static let inkSoft = Color(red: 0.36, green: 0.325, blue: 0.278)
    static let inkFaint = Color(red: 0.604, green: 0.561, blue: 0.49)
    static let gold = Color(red: 0.722, green: 0.573, blue: 0.243) // #B8923E
    static let rule = Color(red: 0.85, green: 0.81, blue: 0.74)
}

func hexColor(_ hex: String) -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return Paper.gold }
    return Color(
        red: Double((v >> 16) & 0xFF) / 255,
        green: Double((v >> 8) & 0xFF) / 255,
        blue: Double(v & 0xFF) / 255
    )
}

func fmtMin(_ m: Int) -> String {
    String(format: "%02d:%02d", m / 60, m % 60)
}

// 讀 App Group 快照
enum SnapshotStore {
    static let appGroup = "group.com.qqchen.inkday" // 跟 WidgetBridgePlugin.swift 一致
    static let key = "widgetSnapshot"

    static func todayKey() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: Date())
    }

    /// 讀快照；資料不是今天的就當空（避免顯示昨天的 MIT 誤導）
    static func load() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let raw = defaults.string(forKey: key),
              let data = raw.data(using: .utf8),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
        else { return nil }
        return snap.date == todayKey() ? snap : nil
    }
}

// 共用 TimelineProvider：所有 widget 都吃同一份快照
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snap: WidgetSnapshot.preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snap: SnapshotStore.load() ?? WidgetSnapshot.preview))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: Date(), snap: SnapshotStore.load())
        // 半小時後重讀（跨日/時間軸 now-line 用）；app 寫入時另有 reloadAllTimelines 即時更新
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

extension WidgetSnapshot {
    static let preview = WidgetSnapshot(
        date: SnapshotStore.todayKey(),
        mit: "錄影片：AI 第二大腦",
        mitDone: false,
        tasks: [
            WTask(text: "錄影片：AI 第二大腦", done: 2, target: 4, completed: false),
            WTask(text: "回覆學員", done: 1, target: 2, completed: false),
            WTask(text: "散步 30 分鐘", done: 0, target: 1, completed: false),
        ],
        blocks: [
            WBlock(start: 540, end: 660, text: "深度工作：錄影片", color: "#3d5a73"),
            WBlock(start: 720, end: 780, text: "午餐＋散步", color: "#6f8f6a"),
            WBlock(start: 840, end: 960, text: "剪輯＋上字幕", color: "#b8923e"),
        ],
        streak: 6,
        week: (0..<7).map { i in
            WDay(date: "d\(i)", weekday: ["一", "二", "三", "四", "五", "六", "日"][i],
                 mit: ["錄影片", "寫大綱", "剪輯", "發布", "回顧", "休息", "規劃"][i],
                 mitDone: i < 2, blockCount: [3, 2, 4, 1, 2, 0, 1][i])
        }
    )
}

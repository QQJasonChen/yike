import Foundation
import WidgetKit

// widget → App 的動作佇列（存 App Group）。
// widget 上的互動按鈕（AppIntent, iOS 17+）把動作 append 進來，並「樂觀」改本地快照
// 讓桌面立刻反映；App 回前景時經 WidgetBridgePlugin.drainActions 吸乾佇列、套用到
// localStorage（權威來源），再回推正確快照覆蓋樂觀值。方向：widget → App。
// JS 端：src/widgetSync.ts（applyWidgetAction / drainWidgetActions）。
enum WidgetActions {
    static let appGroup = "group.com.qqchen.inkday" // 跟 WidgetBridgePlugin / SnapshotStore 一致
    static let queueKey = "widgetActionQueue"
    static let openIntentKey = "widgetOpenIntent"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    /// append 一個動作，帶今天日期戳（App 端會丟棄非今天的動作，避免跨日誤套）
    static func enqueue(type: String, taskIndex: Int? = nil) {
        guard let d = defaults else { return }
        var queue = (d.array(forKey: queueKey) as? [[String: Any]]) ?? []
        var item: [String: Any] = ["type": type, "date": SnapshotStore.todayKey()]
        if let i = taskIndex { item["taskIndex"] = i }
        queue.append(item)
        d.set(queue, forKey: queueKey)
    }

    /// 記一個「開啟 App 後要做的事」（如 writeMit＝聚焦最重要任務輸入框）
    static func setOpenIntent(_ intent: String) {
        defaults?.set(intent, forKey: openIntentKey)
    }

    /// 樂觀改本地快照讓 widget 立即反映（App 之後會用權威資料覆蓋）
    static func mutateSnapshot(_ transform: (WidgetSnapshot) -> WidgetSnapshot) {
        guard let d = defaults,
              let raw = d.string(forKey: SnapshotStore.key),
              let data = raw.data(using: .utf8),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
        else { return }
        let next = transform(snap)
        if let out = try? JSONEncoder().encode(next),
           let s = String(data: out, encoding: .utf8) {
            d.set(s, forKey: SnapshotStore.key)
        }
    }

    static func reload() {
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
    }
}

// 樂觀變換（純函數；WidgetSnapshot 欄位為 let，回傳新值）
extension WidgetSnapshot {
    func togglingMit() -> WidgetSnapshot {
        var t = tasks
        if !t.isEmpty {
            let f = t[0]
            t[0] = WTask(text: f.text, done: f.done, target: f.target, completed: !f.completed)
        }
        return WidgetSnapshot(date: date, mit: mit, mitDone: !mitDone, tasks: t,
                              blocks: blocks, streak: streak, week: week)
    }

    func tickingFirstTask() -> WidgetSnapshot {
        var t = tasks
        if !t.isEmpty {
            let f = t[0]
            t[0] = WTask(text: f.text, done: min(f.done + 1, 16), target: f.target, completed: f.completed)
        }
        return WidgetSnapshot(date: date, mit: mit, mitDone: mitDone, tasks: t,
                              blocks: blocks, streak: streak, week: week)
    }
}

import AppIntents
import WidgetKit

// widget 上的互動按鈕動作（iOS 17+ 才支援在 widget 內執行 AppIntent）。
// 每個 intent 只做兩件事：把動作丟進 App Group 佇列 + 樂觀改快照讓桌面立刻反映。
// 真正寫回資料由 App（src/widgetSync.ts drainWidgetActions）在下次回前景時完成。

@available(iOS 17.0, *)
struct ToggleMitIntent: AppIntent {
    static var title: LocalizedStringResource = "完成今天最重要的事"
    func perform() async throws -> some IntentResult {
        WidgetActions.enqueue(type: "toggleMit")
        WidgetActions.mutateSnapshot { $0.togglingMit() }
        WidgetActions.reload()
        return .result()
    }
}

@available(iOS 17.0, *)
struct AddTickIntent: AppIntent {
    static var title: LocalizedStringResource = "塗一格專注"
    func perform() async throws -> some IntentResult {
        WidgetActions.enqueue(type: "tick", taskIndex: 0)
        WidgetActions.mutateSnapshot { $0.tickingFirstTask() }
        WidgetActions.reload()
        return .result()
    }
}

// 空狀態「✏️ 寫下」：開 App + 記下要聚焦最重要任務輸入框（不需 URL scheme）
@available(iOS 17.0, *)
struct WriteMitIntent: AppIntent {
    static var title: LocalizedStringResource = "寫下今天那件事"
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult {
        WidgetActions.setOpenIntent("writeMit")
        return .result()
    }
}

import Capacitor
import Foundation
import WidgetKit

// Widget 資料橋：JS 把「今天＋本週」快照（JSON 字串）丟進來，
// 存進 App Group 共享容器，並請 WidgetKit 重畫所有 widget。
// JS 端：src/widgetSync.ts；widget 端：ios/YikeWidget/；組裝：docs/WIDGET-SETUP.md
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
    ]

    // ⚠️ 要跟 Xcode 兩個 target 勾的 App Group 名稱一致（docs/WIDGET-SETUP.md 步驟 2）
    static let appGroup = "group.com.qqchen.inkday"
    static let snapshotKey = "widgetSnapshot"

    @objc func update(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot") else {
            call.reject("缺 snapshot")
            return
        }
        guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
            // App Group 還沒在 Xcode 勾（widget 未組裝）——不算錯，靜默成功讓 JS 不重試
            call.resolve()
            return
        }
        defaults.set(snapshot, forKey: Self.snapshotKey)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}

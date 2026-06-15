import Capacitor
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit

// 專注鎖：番茄鐘專注時用 Screen Time API 封鎖分心 App，結束自動解除。
// 部署目標 iOS 16，FamilyControls / ManagedSettings 直接可用，免 #available。
@objc(FocusLockPlugin)
public class FocusLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusLockPlugin"
    public let jsName = "FocusLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLock", returnType: CAPPluginReturnPromise),
    ]

    private let store = ManagedSettingsStore()
    private let defaults = UserDefaults.standard
    private let selKey = "yike.focuslock.selection"

    // MARK: - 選擇持久化

    private func saveSelection(_ sel: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(sel) {
            defaults.set(data, forKey: selKey)
        }
    }

    private func loadSelection() -> FamilyActivitySelection? {
        guard let data = defaults.data(forKey: selKey) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    private func selectionCount(_ sel: FamilyActivitySelection?) -> Int {
        guard let sel = sel else { return 0 }
        return sel.applicationTokens.count + sel.categoryTokens.count
    }

    // MARK: - 上盾 / 解盾

    private func applyShield(_ sel: FamilyActivitySelection) {
        store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
        store.shield.applicationCategories = sel.categoryTokens.isEmpty
            ? ShieldSettings.ActivityCategoryPolicy.none
            : .specific(sel.categoryTokens)
    }

    private func clearShield() {
        store.shield.applications = nil
        store.shield.applicationCategories = ShieldSettings.ActivityCategoryPolicy.none
    }

    private func isLocked() -> Bool {
        !(store.shield.applications?.isEmpty ?? true)
    }

    // MARK: - JS 方法

    @objc func isSupported(_ call: CAPPluginCall) {
        // 部署目標 16，能跑到這裡就支援
        call.resolve(["supported": true])
    }

    @objc func getState(_ call: CAPPluginCall) {
        let authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        call.resolve([
            "supported": true,
            "authorized": authorized,
            "hasSelection": selectionCount(loadSelection()) > 0,
            "locked": isLocked(),
        ])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                call.resolve(["authorized": true])
            } catch {
                call.resolve(["authorized": false, "error": error.localizedDescription])
            }
        }
    }

    @objc func pickApps(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let current = self.loadSelection() ?? FamilyActivitySelection()
            let picker = AppPickerView(
                initial: current,
                onDone: { sel in
                    self.saveSelection(sel)
                    call.resolve(["count": self.selectionCount(sel), "cancelled": false])
                },
                onCancel: {
                    call.resolve(["count": self.selectionCount(current), "cancelled": true])
                }
            )
            let host = UIHostingController(rootView: picker)
            host.isModalInPresentation = true // 強制用按鈕關閉，避免下滑取消讓 promise 卡住
            guard let presenter = self.bridge?.viewController else {
                call.reject("無法取得畫面")
                return
            }
            presenter.present(host, animated: true)
        }
    }

    @objc func startLock(_ call: CAPPluginCall) {
        guard let sel = loadSelection(), selectionCount(sel) > 0 else {
            call.resolve(["locked": false, "reason": "no-selection"])
            return
        }
        applyShield(sel)
        call.resolve(["locked": true])
    }

    @objc func stopLock(_ call: CAPPluginCall) {
        clearShield()
        call.resolve(["locked": false])
    }
}

// 系統 App 選擇器（SwiftUI），用 UIHostingController 呈現
private struct AppPickerView: View {
    @State private var selection: FamilyActivitySelection
    let onDone: (FamilyActivitySelection) -> Void
    let onCancel: () -> Void
    @Environment(\.dismiss) private var dismiss

    init(
        initial: FamilyActivitySelection,
        onDone: @escaping (FamilyActivitySelection) -> Void,
        onCancel: @escaping () -> Void
    ) {
        _selection = State(initialValue: initial)
        self.onDone = onDone
        self.onCancel = onCancel
    }

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("選擇要鎖的 App")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") {
                            onCancel()
                            dismiss()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") {
                            onDone(selection)
                            dismiss()
                        }
                    }
                }
        }
    }
}

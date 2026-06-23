import Capacitor
import PencilKit
import UIKit

// 手寫便箋：全螢幕原生 PencilKit 編輯器（系統筆刷/橡皮擦/壓力感應）。
// 畫完回傳 PNG（顯示用）＋ PKDrawing 資料（可再編輯）。僅 iPad。
@objc(InkPlugin)
public class InkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkPlugin"
    public let jsName = "Ink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "edit", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": UIDevice.current.userInterfaceIdiom == .pad])
    }

    @objc func edit(_ call: CAPPluginCall) {
        let drawingB64 = call.getString("drawing")
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("無法取得畫面")
                return
            }
            let vc = InkEditorVC(drawingBase64: drawingB64)
            vc.onDone = { png, drawing in
                call.resolve(["png": png, "drawing": drawing, "cancelled": false])
            }
            vc.onCancel = {
                call.resolve(["cancelled": true])
            }
            vc.modalPresentationStyle = .fullScreen
            presenter.present(vc, animated: true)
        }
    }
}

// 全螢幕 PencilKit 編輯器
class InkEditorVC: UIViewController {
    var onDone: ((String, String) -> Void)?
    var onCancel: (() -> Void)?

    private let canvas = PKCanvasView()
    private let toolPicker = PKToolPicker()
    private let initialDrawingB64: String?

    init(drawingBase64: String?) {
        self.initialDrawingB64 = drawingBase64
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.961, green: 0.941, blue: 0.902, alpha: 1) // 紙色

        let bar = UIView()
        bar.backgroundColor = UIColor(white: 1, alpha: 0.55)
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let cancelBtn = makeButton("取消", bold: false, action: #selector(cancelTap))
        let clearBtn = makeButton("清除", bold: false, action: #selector(clearTap))
        let doneBtn = makeButton("完成", bold: true, action: #selector(doneTap))
        [cancelBtn, clearBtn, doneBtn].forEach { bar.addSubview($0) }

        canvas.translatesAutoresizingMaskIntoConstraints = false
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput // Pencil 或手指都可畫
        view.addSubview(canvas)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),

            cancelBtn.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 18),
            cancelBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            clearBtn.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            clearBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            doneBtn.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -18),
            doneBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),

            canvas.topAnchor.constraint(equalTo: bar.bottomAnchor),
            canvas.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            canvas.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            canvas.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        if let b64 = initialDrawingB64, let data = Data(base64Encoded: b64),
            let d = try? PKDrawing(data: data) {
            canvas.drawing = d
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        toolPicker.setVisible(true, forFirstResponder: canvas)
        toolPicker.addObserver(canvas)
        canvas.becomeFirstResponder()
    }

    private func makeButton(_ title: String, bold: Bool, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = bold ? .boldSystemFont(ofSize: 17) : .systemFont(ofSize: 17)
        b.setTitleColor(UIColor(red: 0.588, green: 0.451, blue: 0.169, alpha: 1), for: .normal)
        b.addTarget(self, action: action, for: .touchUpInside)
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }

    @objc private func clearTap() { canvas.drawing = PKDrawing() }

    @objc private func cancelTap() {
        dismiss(animated: true) { self.onCancel?() }
    }

    @objc private func doneTap() {
        let drawing = canvas.drawing
        let drawingB64 = drawing.dataRepresentation().base64EncodedString()
        var pngB64 = ""
        let b = drawing.bounds
        if !b.isEmpty {
            let img = drawing.image(from: b, scale: 2.0)
            pngB64 = img.pngData()?.base64EncodedString() ?? ""
        }
        dismiss(animated: true) { self.onDone?(pngB64, drawingB64) }
    }
}

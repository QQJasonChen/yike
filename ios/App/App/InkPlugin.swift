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

// 全螢幕 PencilKit 編輯器（自製工具列：顏色 + 筆/橡皮擦 + 清除，比系統 ToolPicker 在 modal 下更可靠）
class InkEditorVC: UIViewController {
    var onDone: ((String, String) -> Void)?
    var onCancel: (() -> Void)?

    private let canvas = PKCanvasView()
    private let initialDrawingB64: String?
    private let palette: [UIColor] = [
        UIColor(red: 0.169, green: 0.149, blue: 0.125, alpha: 1), // 墨黑
        UIColor(red: 0.859, green: 0.431, blue: 0.110, alpha: 1), // 橘
        UIColor(red: 0.239, green: 0.353, blue: 0.451, alpha: 1), // 藍
        UIColor(red: 0.435, green: 0.561, blue: 0.416, alpha: 1), // 綠
        UIColor(red: 0.714, green: 0.361, blue: 0.220, alpha: 1), // 赭
    ]
    private var currentColor: UIColor = UIColor(red: 0.169, green: 0.149, blue: 0.125, alpha: 1)
    private var colorButtons: [UIButton] = []
    private var penBtn: UIButton!
    private var eraserBtn: UIButton!

    init(drawingBase64: String?) {
        self.initialDrawingB64 = drawingBase64
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.961, green: 0.941, blue: 0.902, alpha: 1) // 紙色

        let bar = UIView()
        bar.backgroundColor = UIColor(white: 1, alpha: 0.7)
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let cancelBtn = makeText("取消", bold: false, action: #selector(cancelTap))
        let clearBtn = makeText("清除", bold: false, action: #selector(clearTap))
        let doneBtn = makeText("完成", bold: true, action: #selector(doneTap))

        // 顏色圓鈕
        for (i, c) in palette.enumerated() {
            let b = UIButton(type: .system)
            b.backgroundColor = c
            b.tag = i
            b.layer.cornerRadius = 13
            b.layer.borderWidth = i == 0 ? 2.5 : 0
            b.layer.borderColor = UIColor.darkGray.cgColor
            b.translatesAutoresizingMaskIntoConstraints = false
            b.widthAnchor.constraint(equalToConstant: 26).isActive = true
            b.heightAnchor.constraint(equalToConstant: 26).isActive = true
            b.addTarget(self, action: #selector(colorTap(_:)), for: .touchUpInside)
            colorButtons.append(b)
        }
        penBtn = makeText("✏️ 筆", bold: false, action: #selector(penTap))
        eraserBtn = makeText("橡皮擦", bold: false, action: #selector(eraserTap))

        let colorStack = UIStackView(arrangedSubviews: colorButtons)
        colorStack.spacing = 8
        let tools = UIStackView(arrangedSubviews: [penBtn, eraserBtn])
        tools.spacing = 12

        let stack = UIStackView(arrangedSubviews: [cancelBtn, colorStack, tools, clearBtn, doneBtn])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(stack)

        canvas.translatesAutoresizingMaskIntoConstraints = false
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        view.addSubview(canvas)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 52),
            stack.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            canvas.topAnchor.constraint(equalTo: bar.bottomAnchor),
            canvas.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            canvas.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            canvas.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        if let b64 = initialDrawingB64, let data = Data(base64Encoded: b64),
            let d = try? PKDrawing(data: data) {
            canvas.drawing = d
        }
        applyPen()
    }

    private func makeText(_ title: String, bold: Bool, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = bold ? .boldSystemFont(ofSize: 17) : .systemFont(ofSize: 16)
        b.setTitleColor(UIColor(red: 0.588, green: 0.451, blue: 0.169, alpha: 1), for: .normal)
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func applyPen() {
        canvas.tool = PKInkingTool(.pen, color: currentColor, width: 4)
        penBtn.titleLabel?.font = .boldSystemFont(ofSize: 16)
        eraserBtn.titleLabel?.font = .systemFont(ofSize: 16)
    }

    @objc private func penTap() { applyPen() }
    @objc private func eraserTap() {
        canvas.tool = PKEraserTool(.vector)
        eraserBtn.titleLabel?.font = .boldSystemFont(ofSize: 16)
        penBtn.titleLabel?.font = .systemFont(ofSize: 16)
    }
    @objc private func colorTap(_ sender: UIButton) {
        currentColor = palette[sender.tag]
        for b in colorButtons {
            b.layer.borderWidth = b.tag == sender.tag ? 2.5 : 0
        }
        applyPen()
    }
    @objc private func clearTap() { canvas.drawing = PKDrawing() }
    @objc private func cancelTap() { dismiss(animated: true) { self.onCancel?() } }
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

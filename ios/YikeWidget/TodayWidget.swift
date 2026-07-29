import SwiftUI
import WidgetKit

// 今天的一刻：MIT + 塗圈進度。核心目標＝讓人「輕鬆記錄」。
// iOS 17+：桌面小格可直接互動——點圈打勾完成、點「＋」塗一格、空的時候點「✏️ 寫下」跳進 App 輸入框。
// iOS 16：按鈕降級成純顯示，整塊點擊照系統預設開 App。
// 鎖定畫面（矩形/單行）維持顯示型（accessory 不支援互動）。
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YikeToday", provider: SnapshotProvider()) { entry in
            TodayView(entry: entry)
        }
        .configurationDisplayName("今天的一刻")
        .description("今天最重要的一件事——桌面直接打勾、塗格、或一按寫下。")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) var family
    let entry: SnapshotEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            inline
        case .accessoryRectangular:
            rectangular
        default:
            small
        }
    }

    private var mit: String { entry.snap?.mit ?? "" }
    private var hasMit: Bool { !mit.trimmingCharacters(in: .whitespaces).isEmpty }
    private var mitTask: WTask? { entry.snap?.tasks.first }
    private var mitDone: Bool { entry.snap?.mitDone ?? false }

    // 鎖定畫面單行（顯示型）
    private var inline: some View {
        Text(hasMit ? "★ \(mit)" : "★ 今天最重要的事還沒寫")
    }

    // 鎖定畫面矩形（顯示型）
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("最重要任務").font(.caption2).opacity(0.7)
            Text(hasMit ? mit : "點開寫下今天的一刻 →")
                .font(.headline).lineLimit(2)
            if let t = mitTask, let target = t.target, target > 0 {
                CircleRow(done: t.done, target: target, compact: true)
            }
        }
        .containerBackground(for: .widget) { Color.clear }
    }

    // 主畫面小格（iOS 17 互動）
    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("★ 最重要").font(.caption2).foregroundStyle(Paper.gold)
                Spacer()
                if let s = entry.snap?.streak, s > 0 {
                    Text("\(s) 天").font(.caption2).foregroundStyle(Paper.inkFaint)
                }
            }
            if hasMit {
                mitLine
            } else {
                emptyPrompt
            }
            Spacer(minLength: 0)
            controlRow
        }
        .padding(2)
        .containerBackground(for: .widget) { Paper.bg }
    }

    // MIT 那一行：iOS 17 是「可點打勾的圈 + 文字」，iOS 16 純文字
    private var mitLine: some View {
        Group {
            if #available(iOS 17.0, *) {
                Button(intent: ToggleMitIntent()) {
                    HStack(alignment: .top, spacing: 6) {
                        checkCircle
                        mitText
                    }
                }
                .buttonStyle(.plain)
            } else {
                HStack(alignment: .top, spacing: 6) {
                    checkCircle
                    mitText
                }
            }
        }
    }

    private var checkCircle: some View {
        ZStack {
            Circle().strokeBorder(mitDone ? Paper.gold : Paper.inkFaint, lineWidth: 1.4)
            if mitDone { Circle().fill(Paper.gold).padding(3) }
        }
        .frame(width: 15, height: 15)
        .padding(.top, 1)
    }

    private var mitText: some View {
        Text(mit)
            .font(.system(.subheadline, design: .serif).weight(.semibold))
            .foregroundStyle(mitDone ? Paper.inkFaint : Paper.ink)
            .strikethrough(mitDone, color: Paper.inkFaint)
            .lineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // 空狀態：一按去寫（iOS 17 用 WriteMitIntent 開 App＋聚焦；iOS 16 靠整塊點擊開 App）
    private var emptyPrompt: some View {
        Group {
            if #available(iOS 17.0, *) {
                Button(intent: WriteMitIntent()) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("今天的那一件事，\n是什麼？")
                            .font(.system(.subheadline, design: .serif))
                            .foregroundStyle(Paper.inkSoft)
                        Text("✏️ 寫下")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Paper.gold)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            } else {
                Text("今天的那一件事，\n是什麼？")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(Paper.inkSoft)
            }
        }
    }

    // 塗圈進度 + iOS 17 的「＋」塗一格按鈕
    @ViewBuilder private var controlRow: some View {
        if let t = mitTask, let target = t.target, target > 0 {
            HStack(spacing: 6) {
                CircleRow(done: t.done, target: target, compact: false)
                Spacer(minLength: 0)
                if #available(iOS 17.0, *), !mitDone {
                    Button(intent: AddTickIntent()) {
                        Text("＋")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Paper.gold)
                            .frame(width: 22, height: 22)
                            .overlay(Circle().strokeBorder(Paper.gold.opacity(0.6), lineWidth: 1.2))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// 塗圈進度 ●●●○
struct CircleRow: View {
    let done: Int
    let target: Int
    let compact: Bool

    var body: some View {
        HStack(spacing: compact ? 3 : 4) {
            ForEach(0..<min(target, 8), id: \.self) { i in
                Circle()
                    .strokeBorder(compact ? Color.primary.opacity(0.6) : Paper.gold, lineWidth: 1.2)
                    .background(Circle().fill(i < done ? (compact ? Color.primary.opacity(0.6) : Paper.gold) : Color.clear))
                    .frame(width: compact ? 8 : 11, height: compact ? 8 : 11)
            }
            if target > 8 { Text("+\(target - 8)").font(.caption2).opacity(0.6) }
        }
    }
}

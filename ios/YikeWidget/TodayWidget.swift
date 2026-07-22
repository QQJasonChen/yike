import SwiftUI
import WidgetKit

// 今天的一刻：MIT + 塗圈進度。支援主畫面小格 + 鎖定畫面（矩形/單行）。
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YikeToday", provider: SnapshotProvider()) { entry in
            TodayView(entry: entry)
        }
        .configurationDisplayName("今天的一刻")
        .description("今天最重要的一件事，和塗圈進度。")
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

    // 鎖定畫面單行
    private var inline: some View {
        Text(hasMit ? "★ \(mit)" : "★ 今天最重要的事還沒寫")
    }

    // 鎖定畫面矩形
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

    // 主畫面小格
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
                Text(mit)
                    .font(.system(.subheadline, design: .serif).weight(.semibold))
                    .foregroundStyle((entry.snap?.mitDone ?? false) ? Paper.inkFaint : Paper.ink)
                    .strikethrough(entry.snap?.mitDone ?? false, color: Paper.inkFaint)
                    .lineLimit(3)
            } else {
                Text("今天的那一件事，\n是什麼？")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(Paper.inkSoft)
            }
            Spacer(minLength: 0)
            if let t = mitTask, let target = t.target, target > 0 {
                CircleRow(done: t.done, target: target, compact: false)
            }
        }
        .padding(2)
        .containerBackground(for: .widget) { Paper.bg }
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

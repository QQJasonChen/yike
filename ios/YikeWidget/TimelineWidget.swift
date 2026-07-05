import SwiftUI
import WidgetKit

// 今日時間軸：中格顯示接下來的時間塊，大格顯示 MIT + 全日時間軸。
struct TimelineWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YikeTimeline", provider: SnapshotProvider()) { entry in
            TimelineView(entry: entry)
        }
        .configurationDisplayName("今日時間軸")
        .description("今天的時間塊安排，一眼看完。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct TimelineView: View {
    @Environment(\.widgetFamily) var family
    let entry: SnapshotEntry

    private var blocks: [WBlock] { entry.snap?.blocks ?? [] }
    private var nowMin: Int {
        let c = Calendar.current
        return c.component(.hour, from: entry.date) * 60 + c.component(.minute, from: entry.date)
    }
    /// 中格空間有限：優先顯示「還沒結束」的塊
    private var upcoming: [WBlock] {
        let left = blocks.filter { $0.end > nowMin }
        return left.isEmpty ? blocks : left
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("今日時間軸").font(.caption).foregroundStyle(Paper.gold)
                Spacer()
                if family == .systemLarge, let s = entry.snap, !s.mit.isEmpty {
                    Text("★ \(s.mit)").font(.caption).foregroundStyle(Paper.inkSoft).lineLimit(1)
                }
            }
            if blocks.isEmpty {
                Spacer()
                Text("今天還沒排時間塊——\n點開拖一段深度工作吧。")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(Paper.inkSoft)
                Spacer()
            } else {
                let rows = family == .systemLarge ? blocks : Array(upcoming.prefix(3))
                ForEach(rows.indices, id: \.self) { i in
                    let b = rows[i]
                    let past = b.end <= nowMin
                    let current = b.start <= nowMin && nowMin < b.end
                    HStack(spacing: 7) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(hexColor(b.color).opacity(past ? 0.35 : 1))
                            .frame(width: 4)
                        Text("\(fmtMin(b.start))–\(fmtMin(b.end))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(past ? Paper.inkFaint : Paper.inkSoft)
                        Text(b.text)
                            .font(.system(.caption, design: .serif).weight(current ? .bold : .regular))
                            .foregroundStyle(past ? Paper.inkFaint : Paper.ink)
                            .strikethrough(past, color: Paper.inkFaint)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if current {
                            Circle().fill(Paper.gold).frame(width: 6, height: 6)
                        }
                    }
                    .frame(maxHeight: 20)
                }
                if family == .systemMedium && upcoming.count > 3 {
                    Text("＋還有 \(upcoming.count - 3) 段")
                        .font(.caption2).foregroundStyle(Paper.inkFaint)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(2)
        .containerBackground(for: .widget) { Paper.bg }
    }
}

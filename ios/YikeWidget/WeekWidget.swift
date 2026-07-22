import SwiftUI
import WidgetKit

// 本週規劃：週一到週日，每天的 MIT + 排程密度，一眼看到這週的形狀。
struct WeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YikeWeek", provider: SnapshotProvider()) { entry in
            WeekView(entry: entry)
        }
        .configurationDisplayName("本週規劃")
        .description("這一週每天的最重要任務與排程。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct WeekView: View {
    @Environment(\.widgetFamily) var family
    let entry: SnapshotEntry

    private var week: [WDay] { entry.snap?.week ?? [] }
    private var todayKey: String { entry.snap?.date ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("本週").font(.caption).foregroundStyle(Paper.gold)
            if week.isEmpty {
                Spacer()
                Text("打開一刻，寫下這週的計畫。")
                    .font(.system(.subheadline, design: .serif))
                    .foregroundStyle(Paper.inkSoft)
                Spacer()
            } else {
                ForEach(week, id: \.date) { d in
                    let isToday = d.date == todayKey
                    HStack(spacing: 7) {
                        Text(d.weekday)
                            .font(.caption2.weight(isToday ? .bold : .regular))
                            .foregroundStyle(isToday ? Paper.gold : Paper.inkFaint)
                            .frame(width: 14)
                        if d.mit.isEmpty {
                            Text("—").font(.caption).foregroundStyle(Paper.rule)
                        } else {
                            Text(d.mit)
                                .font(.system(.caption, design: .serif).weight(isToday ? .semibold : .regular))
                                .foregroundStyle(d.mitDone ? Paper.inkFaint : Paper.ink)
                                .strikethrough(d.mitDone, color: Paper.inkFaint)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        // 排程密度：一塊一點（最多 5 點）
                        HStack(spacing: 2) {
                            ForEach(0..<min(d.blockCount, 5), id: \.self) { _ in
                                Circle().fill(Paper.gold.opacity(0.55)).frame(width: 4, height: 4)
                            }
                        }
                    }
                    .frame(maxHeight: family == .systemLarge ? 22 : 14)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(2)
        .containerBackground(for: .widget) { Paper.bg }
    }
}

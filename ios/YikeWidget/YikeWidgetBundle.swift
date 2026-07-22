import SwiftUI
import WidgetKit

// 一刻手帳 widget 套組：今天的一刻（小格＋鎖定畫面）、今日時間軸（中/大）、本週規劃（中/大）。
// 資料來源：App Group（group.com.qqchen.inkday）的 widgetSnapshot，由主 app 的 WidgetBridgePlugin 寫入。
@main
struct YikeWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        TimelineWidget()
        WeekWidget()
    }
}

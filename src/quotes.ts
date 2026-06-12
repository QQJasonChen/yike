// 每日一句 — 全部經過出處查證（2026-06-11 審核）
// 規則：(1) 有原典的才掛名 (2) 查無原典但流傳廣的標「常被引為」(3) 自己寫的標「一刻原則」
export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  // ✅ 有原典
  { text: '把最重要的事，當成最重要的事。', author: 'Stephen R. Covey' }, // First Things First
  { text: '你做「什麼」比你「怎麼做」更重要。把事情做好，不代表那件事重要。', author: 'Tim Ferriss' }, // The 4-Hour Workweek
  { text: '預測未來最好的方式，就是發明未來。', author: 'Alan Kay' }, // 1971, Xerox PARC
  { text: '人們常說動力不會持久。洗澡也是——所以我們建議每天都做。', author: 'Zig Ziglar' },
  { text: '幾乎每個成功的人都始於兩個信念：未來可以更好，而我有能力讓它實現。', author: 'David Brooks' }, // The Road to Character
  { text: '無論人生看起來多困難，總有你能做到並且成功的事。', author: 'Stephen Hawking' }, // 2012 帕運開幕
  { text: '如果你不設計自己的人生計畫，你很可能會落入別人的計畫裡。', author: 'Jim Rohn' }, // 演講與著作多次出現
  { text: '不是時間不夠，而是我們浪費了太多。', author: 'Seneca' }, // De Brevitate Vitae
  { text: '專注，就是說「不」。', author: 'Steve Jobs' }, // WWDC 1997
  { text: '我們如何度過每一天，就是我們如何度過一生。', author: 'Annie Dillard' }, // The Writing Life
  { text: '完成，勝過完美。', author: 'Facebook 標語・Sheryl Sandberg 推廣' }, // Lean In
  { text: '深度工作的能力日益稀有，也因此日益值錢。', author: 'Cal Newport' }, // Deep Work
  { text: '小細節至關重要。小事成就大事。', author: 'John Wooden' },
  { text: '少，但是更好。', author: 'Dieter Rams・Greg McKeown 發揚' }, // Weniger, aber besser
  { text: '開始的方法，就是停止空談、動手去做。', author: 'Walt Disney' }, // 1957 Hedda Hopper 訪談
  { text: '每天進步 1%，一年後你會強大 37 倍。', author: 'James Clear' }, // Atomic Habits
  { text: '紀律就是自由。', author: 'Jocko Willink' }, // Discipline Equals Freedom
  { text: '你的大腦是用來產生想法的，不是用來囤積它們的。', author: 'David Allen' }, // Getting Things Done
  { text: '先吃掉那隻青蛙。', author: 'Brian Tracy' }, // Eat That Frog!（書名）
  { text: '一次只做一件事，是最快的做事方式。', author: 'Gary Keller《The ONE Thing》' },
  { text: '工作有其美德，休息也有其美德。兩者並用，缺一不可。', author: 'Alan Cohen' },

  // ⚠️ 流傳極廣但查無原典——誠實標註，不假掛名人
  { text: '如果你不規劃，你就是在規劃失敗。', author: '西方諺語（常被誤掛富蘭克林）' }, // QI：最早為 1919 H. K. Williams
  { text: '能被衡量的，才能被管理。', author: '管理學格言（杜拉克其實沒說過）' }, // Drucker Institute 證實
  { text: '持續改善，勝過延遲的完美。', author: '佚名（常被引為馬克・吐溫）' },
  { text: '行動不一定帶來快樂，但沒有行動就沒有快樂。', author: '佚名（常被引為狄斯雷利）' },
  { text: '你永遠有兩個選擇：你的承諾，或你的恐懼。', author: '佚名（常被引為 Sammy Davis Jr.）' },

  // ✍️ 自己的原則
  { text: '時間是你最寶貴的資產。錢會來來去去，時間一旦失去就永遠失去。', author: '一刻原則' },
  { text: '最重要的任務，通常是最不舒服、最容易被拖延的那一件。', author: '一刻原則' },
  { text: '少即是多。每天最多五件事。', author: '一刻原則' },
  { text: '誠實是最好的策略——尤其是對自己。', author: '一刻原則' },
  { text: '你不需要更多時間，你需要更少干擾。', author: '一刻原則' },
]

/** 依日期穩定取得當日名言 */
export const quoteForDate = (dateKey: string): Quote => {
  let hash = 0
  for (const ch of dateKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return QUOTES[hash % QUOTES.length]
}

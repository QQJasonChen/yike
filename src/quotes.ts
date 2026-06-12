// 每日一句 — 全部經過出處查證（2026-06-11 審核）
// 規則：(1) 有原典的才掛名 (2) 查無原典但流傳廣的標「常被引為」(3) 自己寫的標「一刻原則」
export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  // ✅ 有原典
  { text: '把最重要的事，當成最重要的事。', author: 'Stephen R. Covey' }, // First Things First
  { text: '做「對的事」比「把事做對」重要——事情做得再漂亮，不代表它值得做。', author: 'Tim Ferriss' }, // The 4-Hour Workweek
  { text: '預測未來最好的方法，就是親手把它做出來。', author: 'Alan Kay' }, // 1971, Xerox PARC
  { text: '動力不持久？洗澡也不持久，所以你每天洗。', author: 'Zig Ziglar' },
  { text: '成功的人幾乎都從兩個信念開始：未來可以更好，而我有能力讓它變好。', author: 'David Brooks' }, // The Road to Character
  { text: '人生再難，總有一件你做得到、而且能做得好的事。', author: 'Stephen Hawking' }, // 2012 帕運開幕
  { text: '如果你不設計自己的人生計畫，你很可能會落入別人的計畫裡。', author: 'Jim Rohn' }, // 演講與著作多次出現
  { text: '不是時間不夠，而是我們浪費了太多。', author: 'Seneca' }, // De Brevitate Vitae
  { text: '專注，就是說「不」。', author: 'Steve Jobs' }, // WWDC 1997
  { text: '我們如何度過每一天，就是我們如何度過一生。', author: 'Annie Dillard' }, // The Writing Life
  { text: '完成，勝過完美。', author: 'Facebook 標語・Sheryl Sandberg 推廣' }, // Lean In
  { text: '能深度專注的人愈來愈少——所以愈來愈值錢。', author: 'Cal Newport' }, // Deep Work
  { text: '把小事做好，大事自然發生。', author: 'John Wooden' },
  { text: '少，但是更好。', author: 'Dieter Rams・Greg McKeown 發揚' }, // Weniger, aber besser
  { text: '開始的方法，就是停止空談、動手去做。', author: 'Walt Disney' }, // 1957 Hedda Hopper 訪談
  { text: '每天進步 1%，一年後你會強大 37 倍。', author: 'James Clear' }, // Atomic Habits
  { text: '紀律就是自由。', author: 'Jocko Willink' }, // Discipline Equals Freedom
  { text: '大腦是拿來想事情的，不是拿來記事情的。', author: 'David Allen' }, // Getting Things Done
  { text: '先吃掉那隻青蛙。', author: 'Brian Tracy' }, // Eat That Frog!（書名）
  { text: '一次只做一件事，是最快的做事方式。', author: 'Gary Keller《The ONE Thing》' },
  { text: '工作是美德，休息也是。兩個都要，缺一不可。', author: 'Alan Cohen' },

  // ⚠️ 流傳極廣但查無原典——誠實標註，不假掛名人
  { text: '如果你不規劃，你就是在規劃失敗。', author: '西方諺語（常被誤掛富蘭克林）' }, // QI：最早為 1919 H. K. Williams
  { text: '能被衡量的，才能被管理。', author: '管理學格言（杜拉克其實沒說過）' }, // Drucker Institute 證實
  { text: '持續改善，勝過延遲的完美。', author: '佚名（常被引為馬克・吐溫）' },
  { text: '行動不保證快樂；但不行動，保證不快樂。', author: '佚名（常被引為狄斯雷利）' },
  { text: '你永遠有兩個選擇：你的承諾，或你的恐懼。', author: '佚名（常被引為 Sammy Davis Jr.）' },

  // 🧭 Naval Ravikant（推特與《納瓦爾寶典》，皆有原文可查）
  { text: '慾望，是你跟自己簽的合約：在得到它之前，先不快樂。', author: 'Naval Ravikant' }, // Desire is a contract you make with yourself
  { text: '跟長期的人，玩長期的遊戲。', author: 'Naval Ravikant' }, // Play long-term games with long-term people
  { text: '用腦袋賺錢，不要用時間。', author: 'Naval Ravikant' }, // Earn with your mind, not your time
  { text: '把自己產品化。', author: 'Naval Ravikant' }, // Productize yourself
  { text: '人生所有真正的回報，都來自複利。', author: 'Naval Ravikant' }, // compound interest
  { text: '猶豫不決的時候，答案就是「不」。', author: 'Naval Ravikant' }, // If you can't decide, the answer is no
  { text: '用真實做自己，逃離所有競爭。', author: 'Naval Ravikant' }, // Escape competition through authenticity
  { text: '獨特的知識，藏在你真正的好奇心裡。', author: 'Naval Ravikant' }, // Specific knowledge is found by pursuing your genuine curiosity
  { text: '平靜的心、健康的身體、充滿愛的家——這些買不到，只能自己掙。', author: 'Naval Ravikant' }, // A calm mind, a fit body, a house full of love
  { text: '靈感是會過期的。一有靈感，立刻行動。', author: 'Naval Ravikant' }, // Inspiration is perishable

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

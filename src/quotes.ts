// 每日一句 — 仿手帳每頁開頭的 productivity 名言
export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  { text: '把最重要的事，當成最重要的事。', author: 'Stephen R. Covey' },
  { text: '你做「什麼」比你「怎麼做」更重要。把事情做好，不代表那件事重要。', author: 'Tim Ferriss' },
  { text: '如果你不規劃，你就是在規劃失敗。', author: 'Benjamin Franklin' },
  { text: '能被衡量的，才能被管理。', author: 'Peter F. Drucker' },
  { text: '持續改善，勝過延遲的完美。', author: 'Mark Twain' },
  { text: '預測未來最好的方式，就是創造未來。', author: 'Alan Kay' },
  { text: '工作有其美德，休息也有其美德。兩者並用，缺一不可。', author: 'Alan Cohen' },
  { text: '人們常說動力不會持久。洗澡也是——所以我們建議每天都做。', author: 'Zig Ziglar' },
  { text: '幾乎每個成功的人都始於兩個信念：未來可以更好，而我有能力讓它實現。', author: 'David Brooks' },
  { text: '無論人生看起來多困難，總有你能做到並且成功的事。', author: 'Stephen Hawking' },
  { text: '如果你不設計自己的人生計畫，你很可能會落入別人的計畫裡。', author: 'Jim Rohn' },
  { text: '你永遠有兩個選擇：你的承諾，或你的恐懼。', author: 'Sammy Davis Jr.' },
  { text: '不是時間不夠，而是我們浪費了太多。', author: 'Seneca' },
  { text: '專注是說「不」的藝術。', author: 'Steve Jobs' },
  { text: '行動不一定帶來快樂，但沒有行動就沒有快樂。', author: 'Benjamin Disraeli' },
  { text: '今天做的事，決定你明天成為的人。', author: 'Ralph Waldo Emerson' },
  { text: '完成，勝過完美。', author: 'Sheryl Sandberg' },
  { text: '深度工作的能力，是這個時代最稀缺的超能力。', author: 'Cal Newport' },
  { text: '小事重複做，就是大事。', author: 'John Wooden' },
  { text: '與其更努力，不如更專注。', author: 'Greg McKeown' },
  { text: '你不需要更多時間，你需要更少干擾。', author: '佚名' },
  { text: '開始的方法，就是停止空談、動手去做。', author: 'Walt Disney' },
  { text: '每天進步 1%，一年後你會強大 37 倍。', author: 'James Clear' },
  { text: '紀律就是自由。', author: 'Jocko Willink' },
  { text: '最深的疲憊，來自未完成的事。', author: 'David Allen' },
  { text: '時間是你最寶貴的資產。錢會來來去去，時間一旦失去就永遠失去。', author: '日刻原則' },
  { text: '先吃掉那隻青蛙。', author: 'Brian Tracy' },
  { text: '最重要的任務，通常是最不舒服、最容易被拖延的那一件。', author: '日刻原則' },
  { text: '少即是多。每天最多五件事。', author: '日刻原則' },
  { text: '誠實是最好的策略——尤其是對自己。', author: '日刻原則' },
  { text: '一次只做一件事，是最快的做事方式。', author: 'Gary Keller' },
]

/** 依日期穩定取得當日名言 */
export const quoteForDate = (dateKey: string): Quote => {
  let hash = 0
  for (const ch of dateKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return QUOTES[hash % QUOTES.length]
}

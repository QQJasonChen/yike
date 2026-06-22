// 每日一句 — 以 Naval Ravikant 為主（推特與《納瓦爾寶典》，皆有原文可查）。
// 2026-06-22 改版：大幅換成 Naval，移除流傳廣但查無原典／較弱的句子。
export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  // 🧭 Naval Ravikant —— 財富 × 槓桿 × 長期
  { text: '追求財富，不是金錢或地位。財富是你睡著時，仍替你工作的資產。', author: 'Naval Ravikant' }, // Seek wealth, not money or status
  { text: '出租自己的時間，是不會致富的。', author: 'Naval Ravikant' }, // You're not going to get rich renting out your time
  { text: '用腦袋賺錢，不要用時間。', author: 'Naval Ravikant' }, // Earn with your mind, not your time
  { text: '程式與內容，是不需要許可的槓桿——半夜還在替你工作。', author: 'Naval Ravikant' }, // Code and media are permissionless leverage
  { text: '把自己產品化。', author: 'Naval Ravikant' }, // Productize yourself
  { text: '獨特的知識，藏在你真正的好奇心與熱情裡，無法被訓練出來。', author: 'Naval Ravikant' }, // Specific knowledge
  { text: '擁抱責任，用你自己的名字去承擔風險。', author: 'Naval Ravikant' }, // Embrace accountability
  { text: '跟長期的人，玩長期的遊戲。', author: 'Naval Ravikant' }, // Play long-term games with long-term people
  { text: '人生所有真正的回報，都來自複利。', author: 'Naval Ravikant' }, // All returns come from compound interest
  { text: '行動上要急切，結果上要耐心。', author: 'Naval Ravikant' }, // Impatience with actions, patience with results

  // 🧭 Naval Ravikant —— 學習 × 專注 × 決策
  { text: '致富最重要的技能，是成為一個永遠的學習者。', author: 'Naval Ravikant' }, // becoming a perpetual learner
  { text: '教育免費而豐沛，稀缺的是學習的渴望。', author: 'Naval Ravikant' }, // It's the desire to learn that's scarce
  { text: '讀你愛讀的，直到你愛上閱讀。', author: 'Naval Ravikant' }, // Read what you love until you love to read
  { text: '靈感是會過期的。一有靈感，立刻行動。', author: 'Naval Ravikant' }, // Inspiration is perishable
  { text: '猶豫不決的時候，答案就是「不」。', author: 'Naval Ravikant' }, // If you can't decide, the answer is no
  { text: '把時間花在三個最重要的決定上：住哪裡、跟誰在一起、做什麼。', author: 'Naval Ravikant' }, // the three big decisions
  { text: '塞滿的行事曆和塞滿的腦袋，會毀掉你做大事的能力。', author: 'Naval Ravikant' }, // A busy calendar and a busy mind
  { text: '成為你所做之事的世界第一——不斷重新定義你做的事，直到這成真。', author: 'Naval Ravikant' }, // Become the best in the world
  { text: '用真實做自己，逃離所有競爭。', author: 'Naval Ravikant' }, // Escape competition through authenticity
  { text: '玩愚蠢的遊戲，就贏得愚蠢的獎品。', author: 'Naval Ravikant' }, // Play stupid games, win stupid prizes

  // 🧭 Naval Ravikant —— 快樂 × 平靜 × 人生
  { text: '慾望，是你跟自己簽的合約：在得到它之前，先不快樂。', author: 'Naval Ravikant' }, // Desire is a contract
  { text: '快樂是一種選擇，也是一種可以練習的技能。', author: 'Naval Ravikant' }, // Happiness is a choice and a skill
  { text: '平靜的心、健康的身體、充滿愛的家——這些買不到，只能自己掙。', author: 'Naval Ravikant' }, // A calm mind, a fit body
  { text: '嫉妒毫無意義——你無法只挑別人人生的一部分，要就是整套換過去。', author: 'Naval Ravikant' }, // on jealousy
  { text: '如果你無法想像和一個人合作一輩子，就一天都別合作。', author: 'Naval Ravikant' }, // work with someone for life
  { text: '智慧唯一真正的考驗，是你能不能過上自己想要的人生。', author: 'Naval Ravikant' }, // The only real test of intelligence

  // ✦ 其他經得起時間的（皆有原典）
  { text: '專注，就是說「不」。', author: 'Steve Jobs' }, // WWDC 1997
  { text: '能深度專注的人愈來愈少——所以愈來愈值錢。', author: 'Cal Newport' }, // Deep Work
  { text: '我們如何度過每一天，就是我們如何度過一生。', author: 'Annie Dillard' }, // The Writing Life
  { text: '不是時間不夠，而是我們浪費了太多。', author: 'Seneca' }, // De Brevitate Vitae
  { text: '每天進步 1%，一年後你會強大 37 倍。', author: 'James Clear' }, // Atomic Habits
  { text: '一次只做一件事，是最快的做事方式。', author: 'Gary Keller《The ONE Thing》' },
  { text: '把最重要的事，當成最重要的事。', author: 'Stephen R. Covey' }, // First Things First

  // ✍️ 一刻原則
  { text: '最重要的任務，通常是最不舒服、最容易被拖延的那一件。', author: '一刻原則' },
  { text: '你不需要更多時間，你需要更少干擾。', author: '一刻原則' },
]

/** 依日期穩定取得當日名言 */
export const quoteForDate = (dateKey: string): Quote => {
  let hash = 0
  for (const ch of dateKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return QUOTES[hash % QUOTES.length]
}

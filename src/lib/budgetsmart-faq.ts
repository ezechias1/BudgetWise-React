import type { Mode } from '@/types';

/**
 * BudgetSmart's answer bank.
 *
 * Most support questions are the same forty questions, so they're answered
 * from here — instantly, with no network call and nothing to pay per answer.
 *
 * Every answer must describe something the app actually does. An assistant
 * that invents a menu item creates more support mail than it saves, so when
 * you add an entry, click the path first.
 */

/**
 * Where people are sent when nothing matches.
 *
 * This is the address the app already sends its mail from. Change it here
 * once BudgetWise has its own domain — it's the only place it appears.
 */
export const SUPPORT_EMAIL = 'ezechiasmulamba@gmail.com';

/** Shown when the question doesn't match anything in the bank. */
export const NO_ANSWER = `I don't have an answer for that one.

Email **${SUPPORT_EMAIL}** and a person will come back to you. It helps if you say which mode you were in, what you were trying to do, and what happened instead.`;

export interface FaqEntry {
  id: string;
  /** Shown verbatim as a tappable suggestion, so phrase it as a user would. */
  question: string;
  answer: string;
  /**
   * Phrases that pull this entry up. Multi-word phrases score higher than
   * single words because they're less likely to match by accident.
   */
  keywords: string[];
  /** Modes this is *suggested* in. Matching still works from any mode. */
  modes?: Mode[];
}

export const FAQ: FaqEntry[] = [
  // ==========================================================================
  // The basics — asked more often than anything technical
  // ==========================================================================
  {
    id: 'what-is-this',
    question: 'What is BudgetWise?',
    answer:
      'An app for keeping track of where your money goes. You record what you spend, set limits per category, and save towards goals.\n\nIt has three sides to it — **Personal** for your own money, **Business** for a company or side hustle, and **Family** for a shared household budget. There\'s also **Junior**, for kids.',
    keywords: ['what is budgetwise', 'what is the app', 'explain the app', 'how does this work', 'new here'],
  },
  {
    id: 'does-it-hold-money',
    question: 'Does BudgetWise hold my money?',
    answer:
      'No. BudgetWise never touches your actual money — it\'s a record book, not a bank or a wallet.\n\nNothing here can move, take or hold funds. It only stores what you tell it you spent so you can see the pattern.',
    keywords: ['hold my money', 'take my money', 'do you keep my money', 'where is my money', 'store money', 'is my money here', 'send money'],
  },
  {
    id: 'is-it-safe',
    question: 'Is my information safe?',
    answer:
      'Your data sits behind your login and nobody else can read it — including other people in your family, unless you deliberately share an expense by putting it in Family mode.\n\nBudgetWise never asks for your bank password, card number or PIN. If anything ever does, it isn\'t us.',
    keywords: ['is it safe', 'safe', 'secure', 'security', 'private', 'can anyone see', 'hacked', 'is my data safe', 'trust'],
  },
  {
    id: 'cost',
    question: 'How much does BudgetWise cost?',
    answer:
      'Everything is open at the moment — no charge, and nothing is locked behind a paywall.\n\nIf that changes you\'ll be told in advance, not surprised by it.',
    keywords: ['cost', 'price', 'free', 'subscription', 'pro', 'what is pro', 'expensive', 'billing'],
  },
  {
    id: 'phone',
    question: 'Can I use this on my phone?',
    answer:
      'Yes — open the same web address in your phone\'s browser and sign in. Everything works on a small screen.\n\nYou can also add it to your home screen so it opens like a normal app.',
    keywords: ['phone', 'mobile', 'android', 'iphone', 'app store', 'play store', 'download the app', 'tablet', 'install'],
  },
  {
    id: 'offline',
    question: 'Do I need internet to use it?',
    answer:
      'Yes, for anything that saves. Your data lives online so it\'s there on any device you sign in from.\n\nIf your signal drops mid-way through adding something, add it again once you\'re back — nothing half-saves.',
    keywords: ['offline', 'internet', 'wifi', 'no signal', 'without internet', 'airplane mode'],
  },
  {
    id: 'multiple-devices',
    question: 'Can I use it on my laptop and my phone?',
    answer:
      'Yes. Sign in with the same email on both and you\'ll see the same data — add something on your phone and it\'s on your laptop.\n\nYou don\'t need to copy anything across.',
    keywords: ['two devices', 'laptop and phone', 'another device', 'same account', 'sync', 'multiple devices', 'my computer'],
  },

  // ==========================================================================
  // The single most common confusion in the whole app
  // ==========================================================================
  {
    id: 'expenses-missing',
    question: 'My expenses have disappeared!',
    answer:
      'Almost always this is the mode. Personal, Business and Family each keep their own separate expenses — so a Personal expense is invisible while you\'re standing in Business.\n\nCheck the dropdown at the top of the sidebar and switch back. Also check the month selector above the list, since it only shows one month at a time.\n\nIf it\'s genuinely gone after both of those, email support.',
    keywords: ['disappeared', 'expenses gone', 'lost my expenses', 'cant see my expenses', 'missing', 'where are my expenses', 'nothing showing', 'empty', 'deleted everything', 'data gone'],
  },
  {
    id: 'switch-mode',
    question: 'How do I switch between Personal, Business and Family?',
    answer:
      'The dropdown at the very top of the sidebar — the one showing your current mode. Pick another and the whole app switches over.\n\nYou\'ll notice the colour changes too: **green** for Personal, **blue** for Business, **purple** for Family. That\'s the quickest way to tell at a glance which one you\'re in.',
    keywords: ['switch mode', 'change mode', 'personal business family', 'change account', 'switch account', 'business mode', 'family mode', 'personal mode', 'three modes', 'difference between modes'],
  },
  {
    id: 'colours',
    question: 'Why does the app change colour?',
    answer:
      'It tells you which account you\'re in without you having to look. **Green** is Personal, **blue** is Business, **purple** is Family.\n\nIt\'s there so you don\'t accidentally log a grocery run against the business.',
    keywords: ['colour', 'color', 'blue', 'green', 'purple', 'why green', 'why blue', 'why purple', 'changed colour', 'different colour'],
  },

  // ==========================================================================
  // PERSONAL
  // ==========================================================================
  {
    id: 'add-expense',
    question: 'How do I add an expense?',
    answer:
      'Sidebar → Expenses → **Add**. Pick a category, type a description and amount, then **Add Expense**.\n\nFor something quick there\'s an Add box right on the Overview page, and a **Scan** button beside it that reads a photo of a receipt and fills the form in for you.',
    keywords: ['add expense', 'new expense', 'log expense', 'record expense', 'enter expense', 'add spending', 'add transaction', 'put in what i spent'],
    modes: ['personal'],
  },
  {
    id: 'edit-delete-expense',
    question: 'How do I edit or delete an expense?',
    answer:
      'Sidebar → Expenses, find the row, then **Edit** or the bin icon at the end of it.\n\nEditing reopens the same form, so you can fix the category, amount, date or whether it repeats.',
    keywords: ['edit expense', 'delete expense', 'remove expense', 'change expense', 'undo', 'wrong amount', 'made a mistake', 'typed it wrong', 'fix an expense'],
    modes: ['personal'],
  },
  {
    id: 'move-expense',
    question: 'I put an expense in the wrong account — can I move it?',
    answer:
      'Yes. Sidebar → Expenses, find the row, then **Move**, and choose Business or Family. No need to delete it and start again.\n\nOne thing to know: it keeps its original category, so a Personal "Food" expense is still "Food" once it lands in Business.',
    keywords: ['move expense', 'wrong account', 'wrong mode', 'personal to business', 'business to personal', 'move to family', 'transfer expense', 'put it in the wrong'],
  },
  {
    id: 'recurring',
    question: 'How do I set up a recurring expense like rent?',
    answer:
      'When adding or editing an expense, set **Recurring?** to *Yes – Monthly* or *Yes – Weekly*.\n\nThe app also spots expenses you keep entering and offers to mark them recurring for you.',
    keywords: ['recurring', 'repeat', 'every month', 'monthly expense', 'subscription', 'rent every month', 'automatic expense', 'same thing every month', 'debit order'],
  },
  {
    id: 'budget-limits',
    question: 'How do I set a monthly budget limit?',
    answer:
      'Sidebar → Expenses → **Limits**. Set an amount per category, then **Save Limits**.\n\nOnce set, a warning shows above the expense list as you approach it.',
    keywords: ['budget limit', 'set budget', 'monthly limit', 'spending limit', 'cap spending', 'budget warning', 'limits', 'stop overspending', 'set a budget'],
    modes: ['personal'],
  },
  {
    id: 'custom-categories',
    question: 'Can I make my own categories?',
    answer:
      'Sidebar → Expenses → **Categories**. Type a name, pick a colour, **Add**.\n\nHonest heads-up: your own categories show in that list but don\'t yet appear in the dropdown when adding an expense. It\'s a known gap. For now the built-in categories are the ones you can actually pick.',
    keywords: ['custom category', 'own category', 'add category', 'new category', 'my own categories', 'category list', 'cant find category'],
  },
  {
    id: 'savings-goal',
    question: 'How do I create a savings goal?',
    answer:
      'Sidebar → Savings → **New Goal**. Name it, set a target and what you plan to put in monthly, then **Create Goal**.\n\nIt then tells you roughly how long it\'ll take at that rate.',
    keywords: ['savings goal', 'new goal', 'saving target', 'create goal', 'save money for', 'saving up'],
    modes: ['personal'],
  },
  {
    id: 'add-to-goal',
    question: 'How do I put money into a savings goal?',
    answer:
      'Sidebar → Savings, find the goal, then **+ Add**. Type the amount and confirm.\n\nThe progress bar moves straight away.',
    keywords: ['add to goal', 'fund goal', 'contribute', 'put money in goal', 'add savings', 'top up goal', 'deposit into goal'],
  },
  {
    id: 'export',
    question: 'How do I export or download my expenses?',
    answer:
      'Sidebar → Expenses → **Export CSV** or **Export PDF**, above the list.\n\nBoth respect the filters you have on, so choose your month and category first if you only want part of it. CSV opens in Excel; PDF is the one to send an accountant.',
    keywords: ['export', 'download', 'csv', 'pdf', 'spreadsheet', 'excel', 'send to accountant', 'print', 'get my data out', 'statement'],
  },
  {
    id: 'trips',
    question: 'How do trips work?',
    answer:
      'Sidebar → Expenses → **Trips** tab. Create a trip with a date range and expenses in that window group under it.\n\nAfterwards the app asks you to tag each one Business or Personal, which is what makes it useful at tax time.',
    keywords: ['trip', 'travel', 'business trip', 'mileage', 'trips tab', 'travel expenses', 'went away'],
  },
  {
    id: 'stokvel',
    question: 'What is the Stokvel page for?',
    answer:
      'Sidebar → Stokvel. It tracks a savings group — who has contributed, how much, and whose turn it is to be paid out.\n\nIt keeps the record. It doesn\'t move any money between members.',
    keywords: ['stokvel', 'savings group', 'society', 'group savings', 'payout', 'umgalelo'],
  },
  {
    id: 'load-shedding',
    question: 'What does the Load Shedding page do?',
    answer:
      'Sidebar → Load Shedding. It tracks what outages actually cost you — generator fuel, gas, data, a takeaway because the stove was off.\n\nOver a few months it shows you a number most people underestimate.',
    keywords: ['load shedding', 'loadshedding', 'power cut', 'eskom', 'generator', 'outage', 'electricity'],
  },

  // ==========================================================================
  // BUSINESS
  // ==========================================================================
  {
    id: 'add-client',
    question: 'How do I add a client?',
    answer:
      'Business mode → Sidebar → Clients → **Add Client**. Name, email, phone, company — only the name is required.\n\nAdd the client before the invoice, because an invoice has to be attached to one.',
    keywords: ['add client', 'new client', 'customer', 'create client', 'add customer', 'client list'],
    modes: ['business'],
  },
  {
    id: 'create-invoice',
    question: 'How do I create an invoice?',
    answer:
      'Business mode → Sidebar → Invoices → **New Invoice**. Choose the client, describe the work, set the amount and due date, then **Create Invoice**.\n\nIf the client dropdown is empty, that\'s why — add the client first under Sidebar → Clients.',
    keywords: ['create invoice', 'new invoice', 'make invoice', 'bill a client', 'send invoice', 'invoice someone', 'charge a client', 'quote'],
    modes: ['business'],
  },
  {
    id: 'invoice-paid',
    question: 'How do I mark an invoice as paid?',
    answer:
      'Business mode → Sidebar → Invoices, find the row, **Mark Paid**. Status flips to Paid and it moves into the Paid total up top.\n\nThe button then disappears, so nothing can be marked paid twice.',
    keywords: ['mark paid', 'invoice paid', 'got paid', 'client paid', 'mark as paid', 'settle invoice', 'they paid me'],
    modes: ['business'],
  },
  {
    id: 'invoice-delete',
    question: 'How do I delete an invoice?',
    answer:
      'Business mode → Sidebar → Invoices, then the bin icon at the end of the row.\n\nDeleting is permanent — if you only want it out of your pending total, marking it paid is usually what you actually want.',
    keywords: ['delete invoice', 'remove invoice', 'cancel invoice', 'wrong invoice', 'invoice mistake'],
    modes: ['business'],
  },
  {
    id: 'pnl',
    question: 'What is the Profit & Loss page?',
    answer:
      'Business mode → Sidebar → **Profit & Loss**. It sets your revenue against your business expenses for the month and shows the difference, plus where the money went by category.\n\nRevenue counts invoices marked **Paid**, so an unpaid invoice won\'t appear there yet.',
    keywords: ['profit and loss', 'p&l', 'pnl', 'profit', 'revenue', 'how am i doing', 'business performance', 'am i making money', 'income statement'],
    modes: ['business'],
  },
  {
    id: 'tax',
    question: 'How does the Tax page work?',
    answer:
      'Business mode → Sidebar → **Tax**. It estimates what you might owe from the income and expenses you\'ve captured.\n\nTreat it as a planning guide, not a submission — check with an accountant before filing anything with SARS.',
    keywords: ['tax', 'sars', 'tax estimate', 'how much tax', 'tax owed', 'provisional tax', 'vat', 'tax return'],
    modes: ['business'],
  },
  {
    id: 'business-expense',
    question: 'How do I record a business expense?',
    answer:
      'Switch to Business mode first, then Sidebar → Transactions → **Add**.\n\nThe categories change to business ones — Cost of Goods Sold, Payroll, Software, Contractors and so on — which is what feeds Profit & Loss and Tax.',
    keywords: ['business expense', 'company expense', 'record business', 'business spending', 'business cost', 'expense for work'],
    modes: ['business'],
  },

  // ==========================================================================
  // FAMILY
  // ==========================================================================
  {
    id: 'invite-family',
    question: 'How do I invite someone to my family?',
    answer:
      'Family mode → Sidebar → Spending Tracker → **Send invite**. That shares a link.\n\nWhoever opens it signs up or logs in and joins automatically — no code to type. You then approve them, and they get a "You\'ve joined" message next time they open the app.',
    keywords: ['invite', 'add family member', 'invite partner', 'invite spouse', 'join family', 'add someone', 'share budget', 'add my wife', 'add my husband'],
    modes: ['family'],
  },
  {
    id: 'family-privacy',
    question: 'Can my family see all my spending?',
    answer:
      'No. Only expenses saved in **Family** mode are shared.\n\nAnything in Personal or Business stays private to you — the household owner cannot see it. If you want something shared, add it while in Family mode, or use **Move** on the expense.',
    keywords: ['privacy', 'can they see', 'private', 'who can see', 'hide expenses', 'see my spending', 'partner see', 'wife see', 'husband see', 'secret'],
    modes: ['family'],
  },
  {
    id: 'approve-member',
    question: 'Someone joined but can\'t see anything — why?',
    answer:
      'They\'re waiting on approval. Joining puts a person in as pending on purpose, so nobody lands in your household without you agreeing.\n\nFamily mode → Sidebar → Spending Tracker → Linked Members, and approve them there.',
    keywords: ['approve', 'pending', 'cant see anything', 'joined but', 'waiting', 'linked members', 'not showing', 'approve member'],
    modes: ['family'],
  },
  {
    id: 'family-goals',
    question: 'How do family savings goals work?',
    answer:
      'Family mode → Sidebar → **Family Goals**. Everyone approved in the household can see the goal and what\'s been put in.\n\nIt\'s the shared version of a personal savings goal — a car, a holiday, school fees.',
    keywords: ['family goal', 'shared goal', 'save together', 'family savings', 'joint goal'],
    modes: ['family'],
  },
  {
    id: 'remove-member',
    question: 'How do I remove someone from my family?',
    answer:
      'Family mode → Sidebar → Members. Remove them there.\n\nThey lose sight of the shared budget straight away. Their own Personal expenses stay theirs — you never had access to those anyway.',
    keywords: ['remove member', 'kick out', 'delete member', 'take someone off', 'remove family', 'left the family'],
    modes: ['family'],
  },

  // ==========================================================================
  // JUNIOR
  // ==========================================================================
  {
    id: 'add-kid',
    question: 'How do I set up a child on Junior?',
    answer:
      'Family mode → Sidebar → **Junior**, and add a kid. You give them a name and a 4-digit PIN.\n\nThey sign in on their own device using the **Kid sign in** link on the login page and that PIN. They don\'t need an email address.',
    keywords: ['junior', 'add kid', 'add child', 'set up child', 'kids account', 'child account', 'my son', 'my daughter', 'for my kids', 'children'],
    modes: ['family'],
  },
  {
    id: 'kid-pin',
    question: 'My child forgot their PIN',
    answer:
      'Family mode → Sidebar → Members, find the child, and reset the PIN. You can set a new 4-digit one immediately.\n\nYou don\'t need the old one.',
    keywords: ['pin', 'forgot pin', 'reset pin', 'kid pin', 'child pin', 'cant log in kid', 'pin not working', 'change pin', 'wrong pin'],
  },
  {
    id: 'jars',
    question: 'What are the Save, Spend and Give jars?',
    answer:
      'Three buckets a child\'s money splits into, so they see the split rather than one lump.\n\nThey can move money between jars themselves from their Jars page — that\'s the point of it, a small decision they make rather than one you make for them.',
    keywords: ['jars', 'save spend give', 'jar split', 'buckets', 'kid money split', 'pocket money split'],
  },
  {
    id: 'chores',
    question: 'How do chores and rewards work?',
    answer:
      'You set a chore and what it pays. The child marks it done on their side, and it comes to you for approval.\n\nNothing is added to their money until you approve it — Family mode → Sidebar → **Chores**. Approving is what pays them.',
    keywords: ['chores', 'reward', 'pocket money', 'allowance', 'chore', 'pay my kid', 'approve chore', 'kid earn money'],
  },
  {
    id: 'missions',
    question: 'What are missions?',
    answer:
      'Short money lessons a child plays through in the app — saving, spending choices, that kind of thing.\n\nTheir progress saves as they go, so they can stop and come back.',
    keywords: ['missions', 'mission', 'lessons', 'games', 'learning', 'teach my kid'],
  },

  // ==========================================================================
  // Account and troubleshooting
  // ==========================================================================
  {
    id: 'bank-linking',
    question: 'Can I connect my bank account?',
    answer:
      'Not yet. Automatic bank linking isn\'t working — there\'s no live connection to any South African bank at the moment, and I can\'t give you a date.\n\nWhat does work: adding expenses by hand, the **Scan** button on the Overview page for receipts, and importing a CSV statement under Sidebar → Bank.',
    keywords: ['bank', 'connect bank', 'link bank', 'bank account', 'automatic', 'sync bank', 'fnb', 'capitec', 'absa', 'nedbank', 'standard bank', 'tymebank', 'discovery bank', 'link my account'],
  },
  {
    id: 'import-csv',
    question: 'Can I import my bank statement?',
    answer:
      'Yes — Sidebar → Bank → **Import CSV Bank Statement**. Download a CSV statement from your banking app, upload it, and the rows become expenses.\n\nThat\'s the way to bulk-load history while automatic linking is unavailable.',
    keywords: ['import', 'bank statement', 'upload statement', 'csv import', 'bulk add', 'import transactions', 'load history', 'add all at once'],
  },
  {
    id: 'currency',
    question: 'How do I change my currency?',
    answer:
      'Sidebar → Currency. Pick the one you want and everything re-displays in it.\n\nThe page also does live conversions if you deal in more than one. Default is South African Rand.',
    keywords: ['currency', 'change currency', 'rand', 'dollars', 'exchange rate', 'zar', 'convert money', 'pounds', 'euro'],
  },
  {
    id: 'backup',
    question: 'How do I back up my data?',
    answer:
      'Sidebar → Account → **Backup All Data**. That saves a file with everything in it.\n\nTo bring it back, **Restore from Backup** on the same page. Worth doing before any big cleanup.',
    keywords: ['backup', 'restore', 'save my data', 'lose my data', 'export everything', 'data safe', 'copy of my data'],
  },
  {
    id: 'theme',
    question: 'How do I switch to light or dark mode?',
    answer:
      'The sun/moon button at the bottom of the sidebar — top right on a phone. It remembers your choice.',
    keywords: ['dark mode', 'light mode', 'theme', 'too bright', 'night mode', 'change colour scheme', 'white background'],
  },
  {
    id: 'password',
    question: 'How do I reset my password?',
    answer:
      'Sign out, then on the login page tap **Forgot your password?** and enter your email. You\'ll get a reset link.\n\nIf it hasn\'t arrived in a few minutes, check spam before trying again.',
    keywords: ['password', 'forgot password', 'reset password', 'change password', 'cant log in', 'locked out', 'cant sign in'],
  },
  {
    id: 'no-email',
    question: 'I signed up but never got the confirmation email',
    answer:
      'Check spam or promotions first — that\'s usually where it is.\n\nIf it genuinely hasn\'t arrived, email support and we\'ll confirm you manually.',
    keywords: ['confirmation email', 'no email', 'didnt get email', 'verify email', 'activation', 'email not arrived', 'cant confirm', 'waiting for email'],
  },
  {
    id: 'logout',
    question: 'How do I log out?',
    answer:
      'The arrow button at the bottom of the sidebar, next to your name.\n\nOn a shared computer it\'s worth doing — otherwise the next person opens the app straight into your money.',
    keywords: ['log out', 'logout', 'sign out', 'exit', 'log off', 'close my session'],
  },
  {
    id: 'delete-account',
    question: 'How do I delete my account or clear my data?',
    answer:
      'Sidebar → Account, at the bottom. There\'s an option to clear your data and one to delete the account entirely.\n\nBoth are permanent — take a backup first if there\'s any chance you\'ll want it back.',
    keywords: ['delete account', 'close account', 'clear data', 'start over', 'delete everything', 'wipe', 'remove my data', 'start fresh'],
  },
  {
    id: 'contact-support',
    question: 'How do I talk to a real person?',
    answer:
      `Email **${SUPPORT_EMAIL}** and someone will come back to you.\n\nInclude which mode you were in, what you were trying to do, and what happened instead — it usually saves a round of back-and-forth.`,
    keywords: ['contact support', 'contact', 'real person', 'human', 'email support', 'report a bug', 'complain', 'speak to someone', 'talk to someone', 'help line', 'helpline'],
  },
];

/** Openers offered when the panel is opened, tuned to the current mode. */
export function suggestionsFor(mode: Mode): FaqEntry[] {
  const inMode = FAQ.filter((e) => e.modes?.includes(mode));
  const general = FAQ.filter((e) => !e.modes);
  return [...inMode, ...general].slice(0, 4);
}

/**
 * Grammatical filler only. Stripping these is what lets "how do I make an
 * invoice" line up with the keyword "make invoice" — without it the two never
 * match, because nobody types the keyword exactly.
 *
 * Deliberately excludes words that carry meaning here — "add", "new", "make",
 * "where", "why", "see", "get" all change which answer is right.
 */
const STOPWORDS = new Set([
  'how', 'do', 'does', 'did', 'i', 'my', 'me', 'the', 'a', 'an', 'is', 'are',
  'was', 'were', 'can', 'could', 'to', 'of', 'it', 'its', 'for', 'on', 'in',
  'at', 'and', 'or', 'but', 'this', 'that', 'these', 'those', 'if', 'there',
  'you', 'your', 'with', 'from', 'be', 'been', 'have', 'has', 'had', 'will',
  'would', 'should', 'am', 'by', 'so', 'than', 'about', 'just', 'please',
  'we', 'us', 'our', 'they', 'them', 'their', 'he', 'she', 'his', 'her',
]);

/** Lowercased, punctuation-free, filler removed, space-padded for matching. */
function contentOf(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  return ` ${words.join(' ')} `;
}

/**
 * Best matching answer, or null when nothing is close enough.
 *
 * Two signals: a whole keyword phrase appearing in the question is strong
 * evidence, and individual meaningful words overlapping is weaker supporting
 * evidence. Both are measured after filler is stripped, so real phrasing
 * ("how do I make an invoice") reaches the keyword ("make invoice").
 *
 * Returning null is the important case. A confident wrong answer costs more
 * support time than no answer, so anything short of a clear match is handed
 * to a human instead.
 */
export function findAnswer(query: string, mode: Mode): FaqEntry | null {
  const queryContent = contentOf(query);
  const queryWords = new Set(queryContent.trim().split(' ').filter(Boolean));
  if (queryWords.size === 0) return null;

  let best: FaqEntry | null = null;
  let bestScore = 0;

  for (const entry of FAQ) {
    let score = 0;
    const entryWords = new Set<string>();

    for (const keyword of [...entry.keywords, entry.question]) {
      const phrase = contentOf(keyword);
      const trimmed = phrase.trim();
      if (!trimmed) continue;
      // A full keyword phrase present in the question is the strong signal.
      if (queryContent.includes(` ${trimmed} `)) score += 3;
      trimmed.split(' ').forEach((w) => entryWords.add(w));
    }

    // Each distinct meaningful word shared with this entry adds a little.
    for (const word of queryWords) if (entryWords.has(word)) score += 1;

    if (score === 0) continue;
    // A nudge, not a thumb on the scale — enough to break a tie between the
    // Business and Family answer to the same words, not enough to win alone.
    if (entry.modes?.includes(mode)) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // Three means one whole phrase landed, or three separate meaningful words
  // did. One or two stray words in common is not an answer.
  return bestScore >= 3 ? best : null;
}

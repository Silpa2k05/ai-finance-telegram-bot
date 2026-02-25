import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import pkg from 'node-nlp';
const { NlpManager } = pkg;
import fs from 'fs';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const manager = new NlpManager({ languages: ['en'], forceNER: true });

const DATA_FILE = './finance.json';
let data = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE))
  : {};

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 🧠 Train NLP
async function trainNLP() {
  manager.addDocument('en', 'set my monthly budget %amount%', 'budget.set');
  manager.addDocument('en', 'my monthly budget is %amount%', 'budget.set');

  manager.addDocument('en', 'I spent %amount%', 'expense.add');
  manager.addDocument('en', 'I bought %item% for %amount%', 'expense.add');
  manager.addDocument('en', 'I purchased %item% for %amount%', 'expense.add');
  manager.addDocument('en', 'I paid %amount% for %item%', 'expense.add');
  manager.addDocument('en', 'I gave %amount% for %item%', 'expense.add');
  manager.addDocument('en', 'add expense %amount%', 'expense.add');

  manager.addDocument('en', 'I received %amount%', 'income.add');
  manager.addDocument('en', 'I got %amount%', 'income.add');
  manager.addDocument('en', 'my friend gave me %amount%', 'income.add');
  manager.addDocument('en', 'I earned %amount%', 'income.add');
  manager.addDocument('en', 'I made %amount%', 'income.add');

  manager.addDocument('en', 'I saved %amount%', 'savings.add');
  manager.addDocument('en', 'I invested %amount%', 'investment.add');

  manager.addDocument('en', 'show my summary', 'summary.show');
  manager.addDocument('en', 'show my weekly summary', 'summary.week');
  manager.addDocument('en', 'show my monthly summary', 'summary.month');

  manager.addDocument('en', 'show stock %symbol%', 'stock.check');
  manager.addDocument('en', 'show me %stock% stock price', 'stock.check');
  manager.addDocument('en', 'get %stock% price', 'stock.check');
  manager.addDocument('en', 'check %stock% price', 'stock.check');

  manager.addDocument('en', 'how much money left', 'balance.check');
  manager.addDocument('en', 'give me spending tips', 'tips.give');
  manager.addDocument('en', 'give me a money-saving tip', 'tips.give');

  manager.addDocument('en', 'help me', 'help.show');
  manager.addDocument('en', 'guide me', 'help.show');
  manager.addDocument('en', 'what can you do', 'help.show');

  await manager.train();
  manager.save();
}

await trainNLP();
console.log('✅ AI Finance Bot is ready and listening for messages!');

// 🧠 Bot message handling
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.toLowerCase();
  if (!text) return;

  if (!data[chatId])
    data[chatId] = { budget: 0, spent: 0, saved: 0, invested: 0, income: 0 };

  const user = data[chatId];
  const result = await manager.process('en', text);
  const intent = result.intent;
  const amount = parseFloat(text.match(/\d+(\.\d+)?/)?.[0] || 0);

  switch (intent) {
    case 'budget.set':
      user.budget = amount;
      saveData();
      bot.sendMessage(chatId, `✅ Monthly budget set to ₹${amount}.`);
      break;

    case 'expense.add':
      if (
        text.includes('received') ||
        text.includes('friend') ||
        text.includes('gave me') ||
        text.includes('got')
      ) {
        bot.sendMessage(chatId, '✅ Not counted as expense — it looks like income.');
        break;
      }
      user.spent += amount;
      saveData();
      const remaining = user.budget - user.spent + user.saved;
      bot.sendMessage(chatId, `💸 You spent ₹${amount}. Remaining budget: ₹${remaining}`);
      if (user.spent > user.budget) {
        bot.sendMessage(chatId, '⚠ You’re overspending! Try to control expenses.');
      }
      break;

    case 'income.add':
      user.income += amount;
      saveData();
      bot.sendMessage(chatId, `💵 Added income: ₹${amount}. Total income: ₹${user.income}`);
      break;

    case 'savings.add':
      user.saved += amount;
      saveData();
      bot.sendMessage(chatId, `💰 Saved ₹${amount}. Total savings: ₹${user.saved}`);
      break;

    case 'investment.add':
      user.invested += amount;
      saveData();
      bot.sendMessage(chatId, `📈 Invested ₹${amount}. Total investment: ₹${user.invested}`);
      break;

    case 'balance.check':
      const left = user.budget - user.spent + user.saved;
      bot.sendMessage(chatId, `💼 Remaining from your monthly budget: ₹${left}`);
      break;

    case 'summary.show':
    case 'summary.week':
    case 'summary.month':
      const summary = `
📊 Your Finance Summary:
💸 Spent: ₹${user.spent}
💰 Saved: ₹${user.saved}
📈 Invested: ₹${user.invested}
🏦 Income: ₹${user.income}
💼 Remaining: ₹${user.budget - user.spent + user.saved}
      `;
      bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
      break;

    case 'stock.check': {
      const indianStocks = {
        reliance: 'RELIANCE.NS',
        infosys: 'INFY.NS',
        tcs: 'TCS.NS',
        hdfc: 'HDFCBANK.NS',
        icici: 'ICICIBANK.NS',
        sbi: 'SBIN.NS',
        wipro: 'WIPRO.NS',
        airtel: 'BHARTIARTL.NS',
        tata: 'TATAMOTORS.NS',
        techm: 'TECHM.NS'
      };

      let symbol = null;
      let keyword = null;
      const words = text.toLowerCase().split(/\s+/);

      for (const w of words) {
        if (indianStocks[w]) {
          symbol = indianStocks[w];
          keyword = w;
          break;
        }
      }

      if (!symbol) {
        const match = text.match(/\b([A-Z]{1,6}(?:\.[A-Z]{2,3})?)\b/i);
        if (match) {
          symbol = match[1].toUpperCase();
          keyword = match[1];
        }
      }

      if (!symbol) {
        const lastWord = words[words.length - 1];
        if (indianStocks[lastWord]) {
          symbol = indianStocks[lastWord];
          keyword = lastWord;
        }
      }

      if (!symbol) {
        bot.sendMessage(chatId, '📈 Please mention a company or stock symbol (e.g. "Show AAPL", "Show Reliance").');
        break;
      }

      async function fetchQuote(sym) {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${ALPHA_KEY}`;
        const res = await axios.get(url);
        console.log('DEBUG GLOBAL_QUOTE for', sym, ':', JSON.stringify(res.data).slice(0, 500));
        return res.data && res.data['Global Quote'] && res.data['Global Quote']['05. price']
          ? res.data['Global Quote']
          : null;
      }

      async function searchSymbol(name) {
        const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(name)}&apikey=${ALPHA_KEY}`;
        const res = await axios.get(url);
        console.log('DEBUG SYMBOL_SEARCH for', name, ':', JSON.stringify(res.data).slice(0, 500));
        const best = res.data?.bestMatches?.[0];
        return best ? best['1. symbol'] : null;
      }

      try {
        let quote = await fetchQuote(symbol);

        if (!quote) {
          const found = await searchSymbol(keyword);
          if (found) {
            quote = await fetchQuote(found);
            symbol = found;
          }
        }

        if (!quote) {
          bot.sendMessage(chatId, `❌ Could not fetch stock info for ${keyword}. Try again later or use a valid symbol.`);
          return;
        }

        const price = quote['05. price'];
        const change = quote['09. change'] || '0';
        const percent = quote['10. change percent'] || '';
        const day = quote['07. latest trading day'] || '';
        const currency = symbol.includes('.NS') || symbol.includes('.BSE') ? '₹' : '$';

        bot.sendMessage(
          chatId,
          `📊 *${symbol} Stock Update*\n${currency}${price}\n📈 Change: ${change} (${percent})\n🕒 Last: ${day}`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('Error fetching stock:', err.message);
        bot.sendMessage(chatId, '⚠ Error fetching stock info. Try again later.');
      }
      break;
    }

    case 'tips.give':
      const tips = [
        '💡 Use the 50/30/20 rule — 50% needs, 30% wants, 20% savings.',
        '💡 Track daily spending — small leaks sink big ships.',
        '💡 Automate your savings like a fixed expense.',
        '💡 Review subscriptions monthly — cancel unused ones.',
        '💡 Cook at home more often — food delivery adds up quickly.'
      ];
      bot.sendMessage(chatId, tips[Math.floor(Math.random() * tips.length)]);
      break;

    case 'help.show':
      bot.sendMessage(
        chatId,
        `🤖 AI Finance Bot — Your Smart Money Assistant 💰
        
Here’s what I can do:
✅ Track expenses, savings, and investments  
✅ Warn when you overspend  
✅ Fetch live stock prices  
✅ Give money-saving tips  
✅ Show daily/weekly/monthly summaries  
✅ Tell how much is left in your budget  

Try saying:
💬 "Set my monthly budget 5000"  
💬 "I bought pizza for 200"  
💬 "I received 1000 from my friend"  
💬 "Show my summary"  
💬 "Show me AAPL stock price"  
💬 "Give me a spending tip"`,
        { parse_mode: 'Markdown' }
      );
      break;

    default:
      bot.sendMessage(chatId, '🤖 Sorry, I didn’t understand that. Type "help" to see what I can do!');
  }
});

const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');
const config = require('./config.json'); 

// Настраиваем OpenAI
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: config.openai_key
  });

const openai = new OpenAIApi(configuration);

// Настраиваем Telegram
const bot = new TelegramBot(config.telegram_bot_token, {polling: true});

// Настраиваем языки и группы, в которых мы будем отвечать
const chatIdLanguageMap = config.chatIdLanguageMap;

bot.on('message', async (msg) => {
    // Если сообщение общее, без упоминания бота, игнорим сообщение
    if( !msg.text || !msg.text.startsWith(config.bot_name) ) {
        return
    }

    // Если бота упомянули в каком-то левом чате, игнорим сообщение
    if( !(String(msg.chat.id) in chatIdLanguageMap)) {
        return
    }
    
    // Если бота упомянули в чате, где он не знает язык, игнорим сообщение
    let languageContext = chatIdLanguageMap[String(msg.chat.id)]
    if (languageContext === undefined) {
        return
    }
    
    // Вырезаем из сообщения упоминание бота
    let userQuery = msg.text.slice(config.bot_name.length).trim();

    console.log(`query=${userQuery}, lang=${languageContext}, user=${msg.from.username}`);
    
    try {
        // Отправляем сообщение о том, что бот печатает
        bot.sendChatAction(msg.chat.id, 'typing');

        // Шлем это оповещение каждые 3 секунды, пока OpenAI не ответит
        let typingInterval = setInterval(() => {
            bot.sendChatAction(msg.chat.id, 'typing');
        }, 3000);

        // Запрашиваем ответ у OpenAI
        const prompt = `Помогай программировать на ${languageContext}. Отвечай как другу на "ты", кратко, с юмором, с минимумом кода`;

        const response = await openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [
            {"role": "system", "content": prompt},
            {"role": "user", "content": userQuery}
          ],
        });

        // Останавливаем оповещение о том, что бот печатает
        clearInterval(typingInterval);
  
        // Отправляем ответ пользователю
        let gptResponse = response.data.choices[0].message.content.trim();
        bot.sendMessage(msg.chat.id, gptResponse, {reply_to_message_id: msg.message_id, parse_mode: 'markdown'});
      }
      catch (error) {
        console.error(error);
        bot.sendMessage(msg.chat.id, "Извините, я не что-то не смог.", {reply_to_message_id: msg.message_id});
      }
});

// Отправляем сообщение админу, когда бот добавили в новый чат
bot.on('new_chat_members', (msg) => {
  if(msg.new_chat_member.username === config.bot_name.slice(1)) {
    bot.sendMessage(config.admin_id, `Меня добавили в новую группу.\n chat.id=${msg.chat.id}\nchat.title=${msg.chat.title}\nuser=${msg.from.username}`);
    console.log(msg);
  }
});

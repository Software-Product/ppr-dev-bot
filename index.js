const TelegramBot = require('node-telegram-bot-api')
const OpenAI = require('openai')

const config = require('./config.json') 

// Настраиваем OpenAI
const { Configuration, OpenAIApi } = require("openai")
const configuration = new Configuration({
    apiKey: config.openai_key
})

let debug = config.debug || false

const openai = new OpenAIApi(configuration)

// Настраиваем Telegram
const bot = new TelegramBot(config.telegram_bot_token, {polling: true})

// Настраиваем языки и группы, в которых мы будем отвечать
const chatIdLanguageMap = config.chatIdLanguageMap

bot.on('message', async (msg) => {
    // Если сообщение не текстовое, игнорим сообщение
    if ( !msg.text ) { return }

    // Определяем как имменно бота упомянули в сообщении
    let isPing = msg.text.startsWith("@" + config.bot_name)
    let isReply = msg.reply_to_message != undefined && msg.reply_to_message.from.username === config.bot_name
    let isMention = msg.text.toLowerCase().startsWith("бот,")

    // Если сообщение общее, без упоминания бота, игнорим сообщение
    if ( isPing === false && isReply === false && isMention === false ) {
      return
    }

    let languageContext = chatIdLanguageMap[String(msg.chat.id)]
    let topicID = msg.message_thread_id

    if (topicID != undefined && typeof languageContext === 'object') { 
      languageContext = languageContext[String(topicID)]
    }

    // Если бота упомянули в чате, где он не знает язык, игнорим сообщение
    if (languageContext === undefined || typeof languageContext !== 'string') {
      return
    }

    // Забираем запрос пользователя
    let userQuery = msg.text.trim()

    // Вырезаем из сообщения упоминание бота
    if ( isPing ) {
      userQuery = userQuery.slice(config.bot_name.length + 1).trim()
    } else if ( isMention ) {
      userQuery = userQuery.slice(4).trim()
    }

    // Логируем запрос
    logMessage(`query=${userQuery}, lang=${languageContext}, user=${msg.from.username}`)
    
    // Для события typing готовим опции под топик, если он есть
    let options = {}
    if ( topicID != undefined ) {
      options.message_thread_id = topicID
    }

    // Отправляем сообщение о том, что бот печатает
    bot.sendChatAction(msg.chat.id, 'typing', options)

    // Шлем это оповещение каждые 3 секунды, пока OpenAI не ответит
    let typingTimer = setInterval(() => {
        bot.sendChatAction(msg.chat.id, 'typing', options)
    }, 3000)

    try {
        // Настраиваем персоналию для OpenAI
        const prompt = `Помогай программировать на ${languageContext}. Отвечай как коллеге на "ты", кратко, с юмором, с минимумом кода`

        // Собираем сообщения для OpenAI
        let messagesList = [
            { "role": "system", "content": prompt} ,
            { "role": "user", "content": userQuery }
        ]

        // Если пользователь отвечает на предыдущее сообщение, то добавляем его в список сообщений для OpenAI
        if (msg.reply_to_message && msg.reply_to_message.from.username === config.bot_name) {
          let botLastMessage = msg.reply_to_message.text
          let userReply = msg.text + ". Код заверни в ```"

          // Заменяем в списке сообщений последний вход, на оригинальный ответ бота
          messagesList.pop()
          messagesList.push(
            { "role": "assistant", "content": botLastMessage },
            { "role": "user", "content": userReply }
          )
        }

        // Запрашиваем ответ у OpenAI
        const apiCall = openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: messagesList,
        })
        
        // Если OpenAI не ответит в течение 30 секунд, то отваливаемся
        const timeout = new Promise((resolve, reject) => {
          const id = setTimeout(() => {
              clearTimeout(id)
              reject(new Error("Что-то затянулось. Давайте попозже."))
          }, config.timeout * 1000)
        })

        // Ждем ответа от OpenAI или таймаута
        Promise.race([apiCall, timeout])
          .then((response) => {
            logMessage(response.data)

            // Вырезаем ответ от OpenAI
            let gptResponse = response.data.choices[0].message.content.trim()

            // Настройки для ответа пользователю
            let options = {
              reply_to_message_id: msg.message_id,
              parse_mode: 'Markdown',
              disable_web_page_preview: true
            }

            // Если сообщение предназначено для топика, прибавляем его к опциям
            if ( topicID != undefined ) {
              options.top_msg_id = topicID
            }

            // Отправляем ответ пользователю
            bot.sendMessage(msg.chat.id, gptResponse, options)

            clearInterval(typingTimer)
          }).catch((error) => {
            sendError(msg.chat.id, error, typingTimer)
          })

     } catch (error) {
        sendError(msg.chat.id, error, typingTimer)
     }
})

function sendError(chatId, error, typingTimer) {
  var listOfErrors = [
    "Произошла ошибка. Попробуйте еще раз.",
    "Что-то пошло не так. Попробуйте еще раз.",
    "Какая-то ерунда. Давайте попозже.",
    "Ох, ошибочка. Попробуйте еще раз."
  ]

  bot.sendMessage(chatId, listOfErrors[Math.floor(Math.random() * listOfErrors.length)])

  logMessage(error)

  // Останавливаем оповещение о том, что бот печатает
  clearInterval(typingTimer)
}

// Отправляем сообщение админу, когда бот добавили в новый чат
bot.on('new_chat_members', (msg) => {
  if ( msg.new_chat_member.username === config.bot_name ) {
    bot.sendMessage(config.admin_id, `Меня добавили в новую группу.\n chat.id=${msg.chat.id}\nchat.title=${msg.chat.title}\nuser=${msg.from.username}`)
    logMessage(msg)
  }
})

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/start') && msg.chat.type === 'private') {
    const response = config.welcome_message
    bot.sendMessage(msg.chat.id, response)
  }
})

function logMessage(error) {
  if ( debug ) {
    console.log(error)
  }
}
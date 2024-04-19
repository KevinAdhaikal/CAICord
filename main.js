var config = require("./config.json")

const { Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, GatewayIntentBits, SlashCommandBuilder, ChannelType, Component, ActivityPlatform} = require('discord.js');
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]});
const WebSocket = require('ws');
const https = require('https');
var webhookClient = "";

var edge_rollout = 27;
var current_group_list;
var user_data;
var ws_con = [0, 0]
var current_group_id;
var current_channel_id;
var current_message_id;
var is_join = 0;
var is_human = 0;
var current_image = {}

function generateRandomUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

function https_fetch(url, path, method, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url,
            path: path,
            method: method,
            headers: {
                'User-Agent': 'Character.AI/1.8.3 (React Native; Android)',
                'DNT': '1',
                'Sec-GPC': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'TE': 'trailers',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.end();
    });
}

function open_ws(index, url, cookie, using_ping, userid) {
    return new Promise((resolve, reject) => {
        ws_con[index] = new WebSocket(url, {
            headers: {
                Cookie: cookie
            }
        })
        if (using_ping) {
            ws_con[index].on('message', async function incoming(message) {
                message = message.toString()
                if (message === "{}") ws_con[index].send("{}")
                else {
                    message = JSON.parse(message)
                    if (message["push"]) {
                        if (message["push"].pub) {
                            if (message["push"].pub.data.turn) {
                                if (message["push"].pub.data.turn.candidates[0].is_final) {
                                    if (!is_human) {
                                        const channel = await client.channels.fetch(current_channel_id);
                                        const fetchedMessage = await channel.messages.fetch(current_message_id);
                                        await fetchedMessage.delete();

                                        await webhookClient.send({
                                            content: message["push"].pub.data.turn.candidates[0].raw_content,
                                            username: message["push"].pub.data.turn.author.name,
                                            avatarURL: current_image[message["push"].pub.data.turn.author.name]
                                        });
                                        const msg = await channel.send({
                                            content: "Please select the bot turn Chat",
                                            components: [
                                                new ActionRowBuilder().addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId("test")
                                                        .setLabel("Testing button")
                                                        .setStyle(ButtonStyle.Primary)
                                                )
                                            ],
                                        })
                                        current_message_id = msg.id
                                    } else is_human = 0;
                                }
                            }
                        }
                    }
                    //console.log(`[${url}] Connection received message: ` + message)
                }
            });
        } else {
            ws_con[index].on('message', function incoming(message) {
                message = message.toString()
                console.log(`[${url}] Connection received message: ` + message)
            });
        }
        ws_con[index].on('close', function close() {
            console.log(`[${url}] Connection closed`);
        });
        ws_con[index].once('open', function open() {
            if (userid) ws_con[index].send(`{"connect":{"name":"js"},"id":1}{"subscribe":{"channel":"user#${userid}"},"id":2}`)
            console.log(`[${url}] Successfully Connected!`)
            resolve()
        })
    });
}

function load_group_chat(interactions, load_history_chat) {
    return new Promise(async (resolve, reject) => {
        let current_gc_history = JSON.parse(await https_fetch("neo.character.ai", `/turns/${current_group_id}/`, "GET", {'Authorization': `Token ${config.cai_token}`}))
        let webhookPromises = [];
        for (let a = (load_history_chat && (current_gc_history.turns.length - load_history_chat) > 0) ? load_history_chat - 1: current_gc_history.turns.length - 1; a > -1; a--) {
            webhookPromises.push(new Promise((resolve, reject) => {
                webhookClient.send({
                    content: current_gc_history.turns[a].candidates[0].raw_content,
                    username: current_gc_history.turns[a].author.name,
                    avatarURL: current_image[current_gc_history.turns[a].author.name]
                }).then(() => resolve()).catch((error) => reject(error));
            }));
        }
        
        Promise.all(webhookPromises)
            .then(async () => {
                interactions.editReply(`Channel has been created: <#${current_channel_id}>\nHistory chat has been loaded!`)
                const msg = await interactions.client.channels.cache.get(current_channel_id).send({
                    content: "Please select the bot turn Chat",
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId("test")
                                .setLabel("Testing button")
                                .setStyle(ButtonStyle.Primary)
                        )
                    ],
                });
                is_join = 1;
                current_message_id = msg.id
                resolve();
            })
            .catch((error) => {
                reject(error);
            });
    });
}

function send_ws(index, data) {
    return new Promise((resolve, reject) => {
        ws_con[index].send(data)
        ws_con[index].once("message", function incoming(data) {
            resolve(data)
        })
    });
}

client.on("ready", async () => {
    console.log("Preparing slash commands...");
    await client.application.commands.create(new SlashCommandBuilder().setName("login").setDescription("Log into Character.AI Server").addStringOption(option => option.setName("token").setDescription("Your Character.AI Token").setRequired(false)))
    await client.application.commands.create(new SlashCommandBuilder().setName("logout").setDescription("Log out from Character.AI Server"))
    await client.application.commands.create(new SlashCommandBuilder().setName("group_list").setDescription("Group Chat List"))
    await client.application.commands.create(new SlashCommandBuilder().setName("group_join").setDescription("Join into Group Chat").addStringOption(option => option.setName("group_name").setDescription("Group Name").setRequired(true)).addIntegerOption(option => option.setName("load_history_chat").setDescription("Load History Chat").setRequired(false)))
    await client.application.commands.create(new SlashCommandBuilder().setName("group_dc").setDescription("Disconnect from Current Group Chat"))
    console.log('Bot is ready!');
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    switch(interaction.commandName) {
        case "login": {
            if (ws_con[0] && ws_con[1]) return interaction.reply("You are already logged in!")

            user_data = JSON.parse(await https_fetch("plus.character.ai", "/chat/user/", "GET", {'Authorization': `Token ${config.cai_token}`}));
            if (!user_data && !user_data.user && !user_data.user.user && !user_data.user.user.id) return interaction.reply("Cannot login into Character.AI: Incorrect Token");

            await open_ws(0, "wss://neo.character.ai/connection/websocket", `edge_rollout=${edge_rollout}; HTTP_AUTHORIZATION="Token ${config.cai_token}"`, true, user_data.user.user.id)
            await open_ws(1, "wss://neo.character.ai/ws/", `edge_rollout=${edge_rollout}; HTTP_AUTHORIZATION="Token ${config.cai_token}"`)
            current_group_list = JSON.parse(await https_fetch("neo.character.ai", "/murooms/?include_turns=false", "GET", {'Authorization': `Token ${config.cai_token}`}))

            interaction.reply("Successfully login into Character.AI Server!")
            break;
        }
        case "logout": {
            if (!ws_con[0] && !ws_con[1]) return interaction.reply("You are already logged out!")

            ws_con[0].close()
            ws_con[1].close()
            user_data = "";
            current_group_list = "";
            is_join = 0;
            ws_con = [0, 0]
            current_image = {}

            interaction.reply("Successfully logged out from Character.AI Server")
        }
        case "group_list": {
            if (!ws_con[0] && !ws_con[1]) return interaction.reply("Please login first")
            if (current_group_list.rooms.length) {
                let send_to_chat = "\`\`\`"
                for (let a = 0; a < current_group_list.rooms.length; a++) {
                    send_to_chat += "Group name: " + current_group_list.rooms[a].title + "\nCharacters list: "
                    for (let b = 0; b < current_group_list.rooms[a].characters.length; b++) {
                        send_to_chat += current_group_list.rooms[a].characters[b].name + ", "
                    }
                    send_to_chat = send_to_chat.slice(0, -2)
                    send_to_chat += "\n\n"
                }
                send_to_chat += "\`\`\`"

                interaction.reply(send_to_chat)
            } else interaction.reply("You have no group chat")
            break;
        }
        case "group_join": {
            if (!ws_con[0] && !ws_con[1]) return interaction.reply("Please login first")
            if (current_group_list.rooms.length) {
                const user_input = interaction.options.getString("group_name", true)
                current_image = {}
                for (let a = 0; a < current_group_list.rooms.length; a++) {
                    if (current_group_list.rooms[a].title === user_input) {
                        current_group_id = current_group_list.rooms[a].id
                        for (let b = 0; b < current_group_list.rooms[a].characters.length; b++) current_image[current_group_list.rooms[a].characters[b].name] = "https://characterai.io/i/400/static/avatars/" + current_group_list.rooms[a].characters[b].avatar_url
                        ws_con[0].send(`{"subscribe":{"channel":"room:${current_group_list.rooms[a].id}"},"id":3}`);
                        const channel = await interaction.guild.channels.create({
                            name: user_input,
                            type: ChannelType.GuildText,
                            parent: interaction.channel.parentId
                        })
                        current_channel_id = channel.id
                        webhookClient = await client.channels.cache.get(channel.id).createWebhook({
                            name: "Character.AI Webhook"
                        })
                        interaction.reply(`Channel has been created: <#${channel.id}>\nLoad History chat...`)
                        return load_group_chat(interaction, interaction.options.getInteger("load_history_chat", false))
                    }
                }
                interaction.reply("Error to join Group chat: Group not found!")
            }
            break;
        }
        case "group_dc": {
            if (!ws_con[0] && !ws_con[1]) return interaction.reply("Please login first")
            ws_con[0].send(`{"unsubscribe":{"channel":"room:${current_group_id}"},"id":3}`);
            interaction.reply("Successfully disconnected from Group Chat")
            await interaction.guild.channels.cache.get(current_channel_id).delete()
            current_group_id = "";
            current_channel_id = "";
            is_join = 0;
            break;
        }
    }
})

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (is_join && ws_con[0] && ws_con[1]) {
        var turn_key = generateRandomUUID()
        is_human = 1;
        await (await message.channel.messages.fetch(current_message_id)).delete()
        await send_ws(0, JSON.stringify({
            "rpc": {
                "method": "unused_command",
                "data": {
                    "command": "create_turn",
                    "request_id": generateRandomUUID().slice(0, -12) + current_group_id.split("-")[4],
                    "payload": {
                        "chat_type": "TYPE_MU_ROOM",
                        "num_candidates": 1,
                        "user_name": user_data.user.user.username,
                        "turn": {
                            "turn_key": {
                                "turn_id": turn_key,
                                "chat_id": current_group_id
                            },
                            "author": {
                                "author_id": `${user_data.user.user.id}`,
                                "is_human": true,
                                "name": user_data.user.user.username
                            },
                            "candidates": [
                                {
                                    "candidate_id": turn_key,
                                    "raw_content": message.content
                                }
                            ],
                            "primary_candidate_id": turn_key
                        }
                    }
                }
            },
            "id": 10
        }))
        const msg = await message.channel.send({
            content: "Please select the bot turn Chat",
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("test")
                        .setLabel("Testing button")
                        .setStyle(ButtonStyle.Primary)
                )
            ],
        })
        current_message_id = msg.id
    }
})

client.login(config.token)
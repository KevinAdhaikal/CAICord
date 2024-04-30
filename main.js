const config = require("./config.json")
const { Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, GatewayIntentBits, SlashCommandBuilder, ChannelType, Component, ActivityPlatform, MessageActivityType, cleanCodeBlockContent, ChatInputCommandInteraction} = require('discord.js');
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]});
const CAINode = new (require("cainode"))();

var is_login = 0;
var is_join = 0;
var result_room_list;
var current_button_turn = new ActionRowBuilder().addComponents();
var current_channel_id;
var current_webhook;
var current_image = {}
var current_message_id;

function generate_gname_id(data) {
    const roomTitles = {};

    data.rooms.forEach(room => {
        const title = room.title.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
        let nameId = title;
        
        if (roomTitles[title] !== undefined) {
            roomTitles[title]++;
            nameId = `${title}_${roomTitles[title]}`;
        } else roomTitles[title] = 1;

        room.name_id = nameId;
    });
    
    return data;
}

client.on("ready", async () => {
    console.log("Preparing slash commands...");

    await client.application.commands.set([
        new SlashCommandBuilder().setName("login").setDescription("Log into Character.AI Server").addStringOption(option => option.setName("token").setDescription("Your Character.AI Token").setRequired(false)),
        new SlashCommandBuilder().setName("logout").setDescription("Log out from Character.AI Server"),
        new SlashCommandBuilder().setName("group_list").setDescription("Group Chat List"),
        new SlashCommandBuilder().setName("group_list_refresh").setDescription("Refresh Group Chat List"),
        new SlashCommandBuilder().setName("group_connect").setDescription("Connect to Group Chat").addStringOption(option => option.setName("name_id_or_group_id").setDescription("Name ID or Group ID").setRequired(true)).addIntegerOption(option => option.setName("load_history_chat").setDescription("Load History Chat").setRequired(false)),
        new SlashCommandBuilder().setName("group_dc").setDescription("Disconnect from Current Group Chat")
    ].map((command) => command.toJSON()));

    console.log('Bot is ready!\nPress CTRL + C to stop the Discord Bot');
});

client.on("interactionCreate", async interaction => {
    if (interaction.isButton()) {
        let result = interaction.customId === "random_turn" ? await CAINode.chat.generate_turn() : await CAINode.chat.selected_turn(interaction.customId)
        await current_webhook.send({
            content: result["push"].pub.data.turn.candidates[0].raw_content,
            username: result["push"].pub.data.turn.author.name,
            avatarURL: current_image[result["push"].pub.data.turn.author.name]
        });
        await interaction.channel.messages.delete(current_message_id);
        current_message_id = (await interaction.channel.send({
            content: "Please select the bot turn Chat",
            components: [current_button_turn],
        })).id
    } else {
        if (!interaction.isChatInputCommand()) return;
        await interaction.deferReply()
        switch(interaction.commandName) {
            case "login": {
                if (is_login) return interaction.editReply("You're already logged in!")
                CAINode.login(config.cai_token).then(async () => {
                    is_login = 1;
                    result_room_list = generate_gname_id(await CAINode.room.list())
                    interaction.editReply("Successfully logged into Character.AI Server")
                }).catch(e => interaction.editReply("Error: " + e))
                break;
            }
            case "group_list": {
                if (!is_login) return interaction.editReply("Please login first!");
                if (result_room_list.rooms.length) {
                    let send_to_chat = "\`\`\`"
                    for (let a = 0; a < result_room_list.rooms.length; a++) {
                        send_to_chat += "Group name ID: " + result_room_list.rooms[a].name_id + "\n"
                        send_to_chat += "Group name: " + result_room_list.rooms[a].title + "\nCharacters list: "
                        for (let b = 0; b < result_room_list.rooms[a].characters.length; b++) {
                            send_to_chat += result_room_list.rooms[a].characters[b].name + ", "
                        }
                        send_to_chat = send_to_chat.slice(0, -2)
                        send_to_chat += "\n\n"
                    }
                    send_to_chat += "\`\`\`"
                    interaction.editReply(send_to_chat)
                } else interaction.editReply("You have no group chat")
                break;
            }
            case "group_list_refresh": {
                if (!is_login) return interaction.editReply("Please login first!");
                result_room_list = await CAINode.room.list()
                interaction.editReply("Group list has been refreshed!")
                break;
            }
            case "group_connect": {
                if (is_join) return interaction.editReply("You're already connected to another Group chat, please disconnect it first")
                
                const name_id_or_group_id = interaction.options.getString("name_id_or_group_id", true)
                const load_history_chat = interaction.options.getInteger("load_history_chat", false)

                current_image = {}

                for (let a = 0; a < result_room_list.rooms.length; a++) {
                    if ((name_id_or_group_id === result_room_list.rooms[a].name_id) || name_id_or_group_id === result_room_list.rooms[a].id) {
                        current_button_turn.addComponents(new ButtonBuilder().setCustomId("random_turn").setLabel("Random Turn").setStyle(ButtonStyle.Primary))
                        for (let b = 0; b < result_room_list.rooms[a].characters.length; b++) {
                            current_button_turn.addComponents(new ButtonBuilder().setCustomId(result_room_list.rooms[a].characters[b].id).setLabel(result_room_list.rooms[a].characters[b].name).setStyle(ButtonStyle.Primary))
                            current_image[result_room_list.rooms[a].characters[b].name] = "https://characterai.io/i/400/static/avatars/" + result_room_list.rooms[a].characters[b].avatar_url
                        }
                        await CAINode.room.connect(result_room_list.rooms[a].id)

                        current_channel_id = (await interaction.guild.channels.create({
                            name: name_id_or_group_id,
                            type: ChannelType.GuildText,
                            parent: interaction.channel.parentId
                        })).id

                        current_webhook = await (await client.channels.fetch(current_channel_id)).createWebhook({name: "Character.AI Webhook"})
                        
                        await interaction.editReply(`Channel has been created: <#${current_channel_id}>\nLoad History chat...`)

                        let history_chat = await CAINode.chat.history_chat_turns()
                        for (let a = (load_history_chat && (history_chat.turns.length - load_history_chat) > 0) ? load_history_chat - 1: history_chat.turns.length - 1; a > -1; a--) {
                            await current_webhook.send({
                                content: history_chat.turns[a].candidates[0].raw_content,
                                username: history_chat.turns[a].author.name,
                                avatarURL: current_image[history_chat.turns[a].author.name]
                            })
                        }

                        await interaction.editReply(`Channel has been created: <#${current_channel_id}>\nHistory chat has been loaded!`)

                        current_message_id = (await (await interaction.client.channels.fetch(current_channel_id)).send({
                            content: "Please select the bot turn Chat",
                            components: [current_button_turn],
                        })).id
                        is_join = 1;
                        return;
                    }
                }
                await interaction.editReply("Group chat not found! Please input the correct Group Chat ID/Name ID");
                break;
            }
            case "group_dc": {
                if (!is_join) return interaction.editReply("You're already disconnected from Group chat!");
                await CAINode.room.disconnect().then(async () => {
                    await interaction.editReply("Successfully disconnected from Group chat!")
                    current_button_turn = new ActionRowBuilder().addComponents()
                    await interaction.guild.channels.delete(current_channel_id)
                    is_join = 0;
                }).catch(e => interaction.editReply("Error: " + e));
                break;
            }
            case "logout": {
                if (!is_login) return interaction.editReply("You're already not connected to Character.AI Server")
                await CAINode.logout()
                interaction.editReply("Successfully logged out from Character.AI Server")
                break;
            }
            default: interaction.editReply("Unknown command!")
        }
    }
})

client.on("messageCreate", async msg => {
    if (!msg.author.bot && is_join && msg.channel.id === current_channel_id) {
        await CAINode.chat.send(msg.content)
        await msg.channel.messages.delete(current_message_id);
        current_message_id = (await msg.channel.send({
            content: "Please select the bot turn Chat",
            components: [current_button_turn],
        })).id
    }
})

process.on('SIGINT', async () => {
    console.log("Exiting...")
    if (is_join) await (await client.channels.fetch(current_channel_id)).delete(current_channel_id)
    await CAINode.logout().catch()
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("Exiting...")
    if (is_join) await (await client.channels.fetch(current_channel_id)).delete(current_channel_id)
    await CAINode.logout().catch()
    process.exit(0);
});

client.login(config.discord_bot_token)
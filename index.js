const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages
    ]
});

const PREFIX = '.';
const roleBackups = new Map();
const jailBackups = new Map();
const forcedNicknames = new Map();
const channelPermBackups = new Map();
const afkUsers = new Map();
const claimedTickets = new Map();
const pendingActions = new Map();
const ticketData = new Map();
const ticketClaimCounts = new Map();
const ticketTranscripts = new Map();
const TICKET_CLAIM_COUNTS_FILE = './ticket_claim_counts.json';

const ticketCategories = {
    'script-key': { name: 'Script/Key Support', emoji: '1497257556295422132' }
};

const WARNINGS_FILE = './warnings.json';
let warns = new Map();

const warnActions = {
    5: { action: 'demote', deleteWarns: true },
};

// ========== GIVEAWAY SYSTEM ==========
const activeGiveaways = new Map();
const endedGiveaways = new Map();
const GIVEAWAYS_FILE = './giveaways.json';
const ENDED_GIVEAWAYS_FILE = './ended_giveaways.json';

// ========== HELPER FUNCTIONS ==========
function createSuccessEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n<a:unknown:1495084306781962432> Action Successful`)
        .setColor(0x00FF00)
        .setTimestamp();
    return embed;
}

function createErrorEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xFF0000)
        .setTimestamp();
    return embed;
}

function createConfirmationEmbed(action, targetUser, moderator) {
    let actionText = '';
    
    switch(action) {
        case 'ban': actionText = 'banned'; break;
        case 'kick': actionText = 'kicked'; break;
        case 'jail': actionText = 'jailed'; break;
        case 'unban': actionText = 'unbanned'; break;
        case 'iunban': actionText = 'unbanned + DM'; break;
    }
    
    const embed = new EmbedBuilder()
        .setAuthor({ name: 'LawsHub Double Verification' })
        .setDescription(`Are you sure you want to ${actionText} ${targetUser.toString()}?`)
        .setColor(0x110084)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: 'LawsHub', iconURL: 'attachment://IMG_1300.jpg' })
        .setTimestamp();
    return embed;
}

function generateConfirmationId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

function createConfirmationButtons(action, confirmationId) {
    let confirmLabel = '';
    switch(action) {
        case 'ban': confirmLabel = 'Confirm Ban'; break;
        case 'kick': confirmLabel = 'Confirm Kick'; break;
        case 'jail': confirmLabel = 'Confirm Jail'; break;
        case 'unban': confirmLabel = 'Confirm Unban'; break;
        case 'iunban': confirmLabel = 'Confirm Unban + DM'; break;
    }
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_${action}_${confirmationId}`)
                .setLabel(confirmLabel)
                .setEmoji('1501147032104992810')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`confirm_cancel_${confirmationId}`)
                .setLabel('Abandon Action')
                .setEmoji('1501148457929281546')
                .setStyle(ButtonStyle.Danger)
        );
    return row;
}

function getUserIdFromInput(input) {
    if (!input) return null;
    let id = input.replace(/[<@!>]/g, '');
    if (/^\d{17,20}$/.test(id)) {
        return id;
    }
    return null;
}

function getReason(argsArray, defaultReason = 'No reason provided') {
    const reason = argsArray.join(' ');
    if (!reason || reason.length === 0) return defaultReason;
    return reason;
}

// ========== LOAD FUNCTIONS ==========
function loadGiveaways() {
    if (fs.existsSync(GIVEAWAYS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8'));
            for (const [key, value] of Object.entries(data)) {
                value.participants = new Set(value.participants);
                activeGiveaways.set(key, value);
            }
            console.log(`✅ Loaded ${activeGiveaways.size} saved giveaways`);
        } catch (e) {}
    }
    if (fs.existsSync(ENDED_GIVEAWAYS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(ENDED_GIVEAWAYS_FILE, 'utf8'));
            for (const [key, value] of Object.entries(data)) {
                value.participants = new Set(value.participants);
                endedGiveaways.set(key, value);
            }
            console.log(`✅ Loaded ${endedGiveaways.size} ended giveaways`);
        } catch (e) {}
    }
}

function saveGiveaways() {
    const activeObj = {};
    for (const [key, value] of activeGiveaways) {
        activeObj[key] = { ...value, participants: [...value.participants] };
    }
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(activeObj, null, 2));
    const endedObj = {};
    for (const [key, value] of endedGiveaways) {
        endedObj[key] = { ...value, participants: [...value.participants] };
    }
    fs.writeFileSync(ENDED_GIVEAWAYS_FILE, JSON.stringify(endedObj, null, 2));
}

function parseDuration(input) {
    const match = input.match(/^(\d+)([dhms])$/);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2];
    switch(unit) {
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'm': return value * 60 * 1000;
        case 's': return value * 1000;
        default: return null;
    }
}

async function updateGiveawayEmbed(giveawayId, channel, messageId, prize, winnerCount, hostId, participants, endTime) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;
    const timeLeft = Math.floor(endTime / 1000);
    const embed = new EmbedBuilder()
        .setTitle('🎁 GIVEAWAY 🎁')
        .setDescription(`**Prize:** ${prize}\n**Hosted by:** <@${hostId}>\n**Entries:** ${participants.size}\n**Winners:** ${winnerCount}\n\nClick the button below to enter!`)
        .addFields(
            { name: '⏰ Time Remaining', value: `<t:${timeLeft}:R>`, inline: true },
            { name: '📅 Ends At', value: `<t:${timeLeft}:F>`, inline: true }
        )
        .setColor(0x2B017F)
        .setTimestamp();
    await message.edit({ embeds: [embed] });
}

async function endGiveaway(giveawayId, channel, messageId, prize, winnerCount, hostId, participants, guildName, endTimestamp, isEarly = false) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;
    const validParticipants = [...participants];
    let winners = [];
    if (validParticipants.length === 0) {
        winners = ['No one participated'];
    } else {
        const shuffled = [...validParticipants];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        winners = shuffled.slice(0, Math.min(winnerCount, shuffled.length));
    }
    const winnerMentions = winners.map(w => w === 'No one participated' ? w : `<@${w}>`).join(', ');
    const endedEmbed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY ENDED 🎉')
        .setDescription(`**Prize:** ${prize}\n\n**Winner(s):** ${winnerMentions}\n\n**Total Entries:** ${validParticipants.length}\n**Hosted by:** <@${hostId}>`)
        .setColor(0xFF0000)
        .setTimestamp();
    await message.edit({ embeds: [endedEmbed], components: [] });
    await channel.send(`🎉 **Giveaway ended!** ${winnerMentions} you won **${prize}**!`);
    for (const winnerId of winners) {
        if (winnerId !== 'No one participated') {
            try {
                const winner = await client.users.fetch(winnerId);
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🎉 You won a giveaway! 🎉')
                    .setDescription(`You won **${prize}** in **${guildName}**!\n\nContact <@${hostId}> to claim your prize.`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await winner.send({ embeds: [dmEmbed] });
            } catch (err) {}
        }
    }
    const giveawayData = activeGiveaways.get(giveawayId);
    if (giveawayData) {
        endedGiveaways.set(giveawayId, { ...giveawayData, winners: winners, endedAt: Date.now(), endedEarly: isEarly });
        activeGiveaways.delete(giveawayId);
    }
    saveGiveaways();
}

loadGiveaways();

setInterval(async () => {
    const now = Date.now();
    for (const [giveawayId, data] of activeGiveaways) {
        if (data.endTime <= now && !data.ended) {
            data.ended = true;
            const channel = await client.channels.fetch(data.channelId).catch(() => null);
            if (channel) {
                await endGiveaway(giveawayId, channel, data.messageId, data.prize, data.winnerCount, data.hostId, data.participants, data.guildName, data.endTime, false);
            }
            saveGiveaways();
        } else if (!data.ended && (!data.lastUpdate || now - data.lastUpdate > 30000)) {
            data.lastUpdate = now;
            const channel = await client.channels.fetch(data.channelId).catch(() => null);
            if (channel) {
                await updateGiveawayEmbed(giveawayId, channel, data.messageId, data.prize, data.winnerCount, data.hostId, data.participants, data.endTime);
            }
        }
    }
}, 1000);

function loadWarnings() {
    if (fs.existsSync(WARNINGS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
            warns = new Map(Object.entries(data));
            console.log(`✅ Loaded ${warns.size} user warnings from file`);
        } catch (e) {}
    }
}

function saveWarnings() {
    const obj = Object.fromEntries(warns);
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(obj, null, 2));
}

function loadTicketClaimCounts() {
    if (fs.existsSync(TICKET_CLAIM_COUNTS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(TICKET_CLAIM_COUNTS_FILE, 'utf8'));
            ticketClaimCounts.clear();
            for (const [key, value] of Object.entries(data)) {
                ticketClaimCounts.set(key, Number(value));
            }
            console.log(`✅ Loaded ${ticketClaimCounts.size} ticket claim counts`);
        } catch (e) {}
    }
}

function saveTicketClaimCounts() {
    const obj = Object.fromEntries(ticketClaimCounts);
    fs.writeFileSync(TICKET_CLAIM_COUNTS_FILE, JSON.stringify(obj, null, 2));
}

function incrementTicketClaimCount(userId) {
    const current = ticketClaimCounts.get(userId) || 0;
    const next = current + 1;
    ticketClaimCounts.set(userId, next);
    saveTicketClaimCounts();
    return next;
}

function storeTicketTranscript(channelId, transcriptData) {
    ticketTranscripts.set(channelId, transcriptData);
    setTimeout(() => ticketTranscripts.delete(channelId), 60 * 60 * 1000);
}

loadWarnings();
loadTicketClaimCounts();

async function createTicketChannel(interaction, ticketType) {
    const guild = interaction.guild;
    const user = interaction.user;
    const categoryId = '1497258380325027960';
    const supportRoleId = '1495189880760828075';
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const existingChannel = channels.find(channel => channel.name === `ticket-${user.id}` && channel.type === 0);
    if (existingChannel) {
        return interaction.reply({ content: '❌ You already have an open ticket! Please close it first.', ephemeral: true });
    }
    try {
        const channel = await guild.channels.create({
            name: `ticket-${user.id}`,
            type: 0,
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
            ]
        });
        const ticketEmbed = new EmbedBuilder()
            .setTitle('LawsHub Ticket Support')
            .setDescription(`<a:unknown:1495084306781962432> **Explain your problem in full detail, please wait for a LawsHub support team to review and answer.**\n\n**Ticket Type:** ${ticketCategories[ticketType]?.name || ticketType}\n**Created by:** ${user.toString()}\n**Claimed by:** Not yet claimed`)
            .setColor(0x2B017F);
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('1501147032104992810'),
                new ButtonBuilder()
                    .setCustomId('ticket_transfer')
                    .setLabel('Transfer Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('1501148457929281546'),
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('1501148457929281546')
            );
        await channel.send({ content: `${user.toString()} <@&${supportRoleId}>`, embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: `<a:unknown:1495084306781962432> Ticket created! Please continue in ${channel.toString()}`, ephemeral: true });

        // Set up auto-close for inactivity
        ticketData.set(channel.id, { ownerId: user.id, createdAt: Date.now(), hasMessaged: false });
        setTimeout(async () => {
            const data = ticketData.get(channel.id);
            if (data && !data.hasMessaged) {
                const embed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setDescription(`<a:unknown:1495084306781962432> Ticket closed due to inactivity (no message from ticket owner in 5 hours).\n\nThis channel will be deleted in 5 seconds.`)
                    .setColor(0xFF0000);
                await channel.send({ embeds: [embed] });
                setTimeout(async () => { try { await channel.delete('Closed due to inactivity'); } catch (err) {} }, 5000);
                ticketData.delete(channel.id);
                claimedTickets.delete(channel.id);
            }
        }, 5 * 60 * 60 * 1000);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Failed to create ticket channel.', ephemeral: true });
    }
}

async function processWarnActions(userId, guild, moderatorId) {
    const userWarns = warns.get(userId);
    if (!userWarns) return false;
    const warnCount = userWarns.length;
    const actionConfig = warnActions[warnCount];
    if (!actionConfig) return false;
    const targetMember = await guild.members.fetch(userId).catch(() => null);
    if (!targetMember) return false;
    const moderator = await guild.members.fetch(moderatorId).catch(() => null);
    const moderatorName = moderator ? moderator.user.tag : 'Auto System';
    let actionPerformed = false;
    let actionDescription = '';
    try {
        switch (actionConfig.action) {
            case 'mute':
                let milliseconds = 0;
                const durationStr = actionConfig.duration;
                const durationValue = parseInt(durationStr);
                const durationUnit = durationStr.slice(-1);
                switch(durationUnit) {
                    case 'm': milliseconds = durationValue * 60 * 1000; break;
                    case 'h': milliseconds = durationValue * 60 * 60 * 1000; break;
                    case 'd': milliseconds = durationValue * 24 * 60 * 60 * 1000; break;
                    default: milliseconds = 60 * 60 * 1000;
                }
                await targetMember.timeout(milliseconds, `Auto-action: ${warnCount} warnings`);
                actionDescription = `muted for ${durationStr}`;
                actionPerformed = true;
                break;
            case 'demote':
                const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                if (userRoles.size > 0) {
                    const highestRole = userRoles.sort((a, b) => b.position - a.position).first();
                    await targetMember.roles.remove(highestRole, `Auto-action: ${warnCount} warnings`);
                    actionDescription = `demoted (removed ${highestRole.name})`;
                    actionPerformed = true;
                } else {
                    actionDescription = `could not demote (no roles to remove)`;
                }
                break;
            case 'ban':
                await targetMember.ban({ reason: `Auto-action: ${warnCount} warnings` });
                actionDescription = `banned`;
                actionPerformed = true;
                break;
        }
        if (actionConfig.deleteWarns && actionPerformed) {
            warns.delete(userId);
            saveWarnings();
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Auto-Action Triggered')
                .setDescription(`**User:** ${targetMember.user.toString()}\n**User ID:** ${userId}\n**Warning Count:** ${warnCount}\n**Action:** ${actionDescription}\n**Moderator:** ${moderatorName}`)
                .setColor(0xFFA500)
                .setTimestamp();
            const logChannelId = process.env.MOD_LOG_CHANNEL_ID;
            if (logChannelId) {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    await logChannel.send({ embeds: [embed] });
                }
            }
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`Action Taken in ${guild.name}`)
                    .setDescription(`You have been ${actionDescription} due to reaching **${warnCount} warnings**.\n\nIf you believe this was a mistake, please contact a moderator.`)
                    .setColor(0xFF0000)
                    .setTimestamp();
                await targetMember.user.send({ embeds: [dmEmbed] });
            } catch (dmError) {}
        }
        return actionPerformed;
    } catch (error) {
        console.error(`Auto-action failed for ${userId}:`, error);
        return false;
    }
}

const startTime = Date.now();

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    console.log(`📦 Loaded ${activeGiveaways.size} active giveaways`);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname === newMember.nickname) return;
    const forcedData = forcedNicknames.get(newMember.id);
    if (!forcedData) return;
    const forcedNickname = forcedData.nickname;
    const currentNick = newMember.nickname;
    if (currentNick !== forcedNickname) {
        try {
            await newMember.setNickname(forcedNickname, `Forced nickname by ${forcedData.moderator}`);
            console.log(`Auto-restored nickname for ${newMember.user.tag} to "${forcedNickname}"`);
        } catch (error) {}
    }
});

// ========== MAIN MESSAGE HANDLER ==========
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // AFK SYSTEM - PING HANDLING
    if (message.mentions.users.size > 0 || message.reference) {
        for (const [userId, afkData] of afkUsers) {
            if (message.mentions.users.has(userId)) {
                afkData.storedMessages.push({
                    author: message.author.tag,
                    authorId: message.author.id,
                    content: message.content,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    timestamp: Date.now()
                });
                if (afkData.storedMessages.length > 10) afkData.storedMessages.shift();
                const duration = Date.now() - afkData.timestamp;
                const minutes = Math.floor(duration / 60000);
                const seconds = Math.floor((duration % 60000) / 1000);
                const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                const afkNotifyEmbed = new EmbedBuilder()
                    .setDescription(`<:unknown:1495103708957118684> **${message.mentions.users.first().username}** is currently AFK\n**Reason:** ${afkData.reason}\n**AFK for:** ${durationText}\n\n*They will see your message when they return.*`)
                    .setColor(0xFFA500);
                await message.reply({ embeds: [afkNotifyEmbed] }).catch(() => {});
            }
        }
    }

    if (afkUsers.has(message.author.id) && !message.content.startsWith(PREFIX + 'afk')) {
        const afkData = afkUsers.get(message.author.id);
        const duration = Date.now() - afkData.timestamp;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        afkUsers.delete(message.author.id);
        try {
            const currentNick = message.member?.nickname;
            if (currentNick && currentNick.startsWith('[AFK]')) {
                const newNick = currentNick.replace('[AFK] ', '').substring(0, 32);
                await message.member.setNickname(newNick, 'AFK mode disabled');
            }
        } catch (err) {}
        const backEmbed = new EmbedBuilder()
            .setDescription(`<a:unknown:1495084306781962432> **${message.author.username}** is no longer AFK\n**Duration:** ${durationText}`)
            .setColor(0x00FF00)
            .setTimestamp();
        await message.reply({ embeds: [backEmbed] });
        if (afkData.storedMessages.length > 0) {
            const storedMessages = afkData.storedMessages;
            const messagesText = storedMessages.map((msg, i) => `**${i + 1}.** ${msg.author} in #${msg.channelName}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`).join('\n\n');
            const storedEmbed = new EmbedBuilder()
                .setTitle('📬 Messages While You Were AFK')
                .setDescription(`You received **${storedMessages.length}** message${storedMessages.length !== 1 ? 's' : ''} while AFK:\n\n${messagesText}`)
                .setColor(0x00AAFF)
                .setTimestamp();
            await message.reply({ embeds: [storedEmbed] });
        }
    }

    // TICKET INACTIVITY TRACKING
    if (message.channel.name.startsWith('ticket-')) {
        const data = ticketData.get(message.channel.id);
        if (data && message.author.id === data.ownerId && !data.hasMessaged) {
            data.hasMessaged = true;
        }
    }

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // AFK SET COMMAND
    if (command === 'afk') {
        const reason = args.join(' ') || 'No reason provided';
        const userId = message.author.id;
        afkUsers.set(userId, { reason: reason, timestamp: Date.now(), storedMessages: [] });
        try {
            const currentNick = message.member.nickname || message.author.username;
            if (!currentNick.startsWith('[AFK]')) {
                await message.member.setNickname(`[AFK] ${currentNick.substring(0, 28)}`, 'AFK mode enabled');
            }
        } catch (err) {}
        const afkEmbed = new EmbedBuilder()
            .setDescription(`<a:unknown:1495084306781962432> **${message.author.username}** is now AFK\n**Reason:** ${reason}`)
            .setColor(0x00FF00)
            .setTimestamp();
        await message.reply({ embeds: [afkEmbed] });
    }

    // GIVEAWAY COMMANDS
    if (command === 'gw') {
        const subCommand = args[0]?.toLowerCase();
        if (subCommand === 'create') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You need **Administrator** permission to start giveaways.');
            }
            const duration = args[1];
            const winnerCount = parseInt(args[2]);
            const prize = args.slice(3).join(' ');
            if (!duration || !winnerCount || !prize) {
                const helpEmbed = new EmbedBuilder()
                    .setTitle('<:unknown:1501163196021604362> Giveaway Help ')
                    .setDescription(`**Usage:** \`.gw create <duration> <winners> <prize>\`\n\n**Examples:**\n\`.gw create 1h 1 Nitro\`\n\`.gw create 2d 3 Discord Nitro\`\n\`.gw create 30m 5 Steam Gift Card\`\n\n**Duration Formats:**\n\`10s\` - seconds\n\`5m\` - minutes\n\`2h\` - hours\n\`1d\` - days`)
                    .setColor(0x2B017F);
                return message.reply({ embeds: [helpEmbed] });
            }
            if (isNaN(winnerCount) || winnerCount < 1 || winnerCount > 25) {
                return message.reply('❌ Winner count must be between 1 and 25.');
            }
            const durationMs = parseDuration(duration);
            if (!durationMs) {
                return message.reply('❌ Invalid duration format. Use: `10s`, `5m`, `2h`, `1d`');
            }
            const endTime = Date.now() + durationMs;
            const giveawayId = Date.now().toString();
            const timeRemaining = Math.floor(endTime / 1000);
            const embed = new EmbedBuilder()
                .setTitle('<:unknown:1501163196021604362> GIVEAWAY')
                .setDescription(`**Prize:** ${prize}\n**Hosted by:** ${message.author.toString()}\n**Entries:** 0\n**Winners:** ${winnerCount}\n\nClick the button below to enter!`)
                .addFields(
                    { name: '⏰ Time Remaining', value: `<t:${timeRemaining}:R>`, inline: true },
                    { name: '📅 Ends At', value: `<t:${timeRemaining}:F>`, inline: true }
                )
                .setColor(0x2B017F)
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_${giveawayId}`).setLabel('🎉 Enter Giveaway').setStyle(ButtonStyle.Success));
            const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });
            activeGiveaways.set(giveawayId, {
                channelId: message.channel.id,
                messageId: giveawayMsg.id,
                prize: prize,
                winnerCount: winnerCount,
                hostId: message.author.id,
                participants: new Set(),
                endTime: endTime,
                ended: false,
                lastUpdate: Date.now(),
                guildName: message.guild.name
            });
            saveGiveaways();
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Giveaway Started!')
                .setDescription(`**Prize:** ${prize}\n**Duration:** ${duration}\n**Winners:** ${winnerCount}\n**Ends:** <t:${timeRemaining}:F>\n\nCheck the giveaway message above to enter!`)
                .setColor(0x00FF00);
            await message.reply({ embeds: [successEmbed] });
            setTimeout(() => message.delete().catch(() => {}), 3000);
        } else if (subCommand === 'reroll') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You need **Administrator** permission to reroll giveaways.');
            }
            const messageId = args[1];
            if (!messageId) return message.reply('❌ Usage: `.gw reroll <message_id>`');
            let foundData = null;
            for (const [id, data] of endedGiveaways) {
                if (data.messageId === messageId) { foundData = data; break; }
            }
            if (!foundData) return message.reply('❌ Could not find that giveaway.');
            const participants = [...foundData.participants];
            if (participants.length === 0) return message.reply('❌ No one participated in that giveaway!');
            const shuffled = [...participants];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const newWinners = shuffled.slice(0, Math.min(foundData.winnerCount, shuffled.length));
            const winnerMentions = newWinners.map(w => `<@${w}>`).join(', ');
            const rerollEmbed = new EmbedBuilder().setTitle('🎉 Giveaway Rerolled! 🎉').setDescription(`**Prize:** ${foundData.prize}\n\n**New Winner(s):** ${winnerMentions}\n\n**Total Entries:** ${participants.length}`).setColor(0x00FF00);
            await message.reply({ embeds: [rerollEmbed] });
        } else if (subCommand === 'end') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You need **Administrator** permission to end giveaways early.');
            }
            const messageId = args[1];
            if (!messageId) return message.reply('❌ Usage: `.gw end <message_id>`');
            let foundGiveaway = null;
            let foundData = null;
            for (const [id, data] of activeGiveaways) {
                if (data.messageId === messageId) { foundGiveaway = id; foundData = data; break; }
            }
            if (!foundData) return message.reply('❌ Could not find that giveaway.');
            if (foundData.ended) return message.reply('❌ That giveaway has already ended.');
            foundData.ended = true;
            const channel = await message.guild.channels.fetch(foundData.channelId);
            await endGiveaway(foundGiveaway, channel, foundData.messageId, foundData.prize, foundData.winnerCount, foundData.hostId, foundData.participants, foundData.guildName, foundData.endTime, true);
            saveGiveaways();
            const endEmbed = new EmbedBuilder().setTitle('✅ Giveaway Ended Early').setDescription(`**Prize:** ${foundData.prize}\n\nGiveaway ended early by ${message.author.toString()}. Winners announced above.`).setColor(0xFFA500);
            await message.reply({ embeds: [endEmbed] });
            setTimeout(() => message.delete().catch(() => {}), 3000);
        } else if (subCommand === 'list') {
            if (activeGiveaways.size === 0 && endedGiveaways.size === 0) return message.reply('❌ There are no giveaways right now.');
            let description = '';
            if (activeGiveaways.size > 0) {
                description += '**🟢 Active Giveaways:**\n\n';
                for (const [id, data] of activeGiveaways) {
                    if (!data.ended) {
                        const endsAt = Math.floor(data.endTime / 1000);
                        description += `**Prize:** ${data.prize}\n**Entries:** ${data.participants.size}\n**Ends:** <t:${endsAt}:R>\n[Jump to giveaway](https://discord.com/channels/${message.guild.id}/${data.channelId}/${data.messageId})\n\n`;
                    }
                }
            }
            if (endedGiveaways.size > 0) {
                description += '\n**🔴 Ended Giveaways (can reroll):**\n\n';
                let count = 0;
                for (const [id, data] of endedGiveaways) {
                    if (count < 10) {
                        description += `**Prize:** ${data.prize}\n**Entries:** ${data.participants.size}\n**Message ID:** \`${data.messageId}\`\n\n`;
                        count++;
                    }
                }
            }
            const listEmbed = new EmbedBuilder().setTitle('🎁 Giveaway List 🎁').setDescription(description).setColor(0x2B017F);
            await message.reply({ embeds: [listEmbed] });
        } else {
            const helpEmbed = new EmbedBuilder()
                .setTitle('🎁 Giveaway Commands 🎁')
                .setDescription(`**Commands:**\n\n\`.gw create <duration> <winners> <prize>\` - Start a giveaway\n\`.gw reroll <message_id>\` - Pick new winners\n\`.gw end <message_id>\` - End giveaway early\n\`.gw list\` - List active giveaways\n\`.gw help\` - Show this help\n\n**Duration Formats:**\n\`10s\` - seconds\n\`5m\` - minutes\n\`2h\` - hours\n\`1d\` - days`)
                .setColor(0x2B017F);
            await message.reply({ embeds: [helpEmbed] });
        }
    }

    // TICKET PANEL
    if (command === 'ticketpanel') {
        const targetChannel = message.mentions.channels.first() || message.channel;
        const panelEmbed = new EmbedBuilder().setTitle('LawsHub Support').setDescription('**Please select a button below to open a ticket.**').setColor(0x2B017F);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_script-key').setLabel('Script/Key').setStyle(ButtonStyle.Primary).setEmoji('1497257556295422132'));
        await targetChannel.send({ embeds: [panelEmbed], components: [row] });
        await message.reply(`✅ Ticket panel sent to ${targetChannel.toString()}`);
    }

    // TICKET COMMANDS
    if (command === 'ticket') {
        const subCommand = args[0]?.toLowerCase();
        if (!message.channel.name.startsWith('ticket-')) return message.reply('❌ This command can only be used in a ticket channel.');
        const userId = message.channel.name.replace('ticket-', '');
        const ticketOwner = await message.guild.members.fetch(userId).catch(() => null);
        const supportRoleId = '1495189880760828075';
        if (subCommand === 'claim') {
            if (!message.member.roles.cache.has(supportRoleId)) return message.reply('❌ You need the Support role to claim tickets.');
            if (claimedTickets.has(message.channel.id)) {
                const claimer = await message.guild.members.fetch(claimedTickets.get(message.channel.id)).catch(() => null);
                return message.reply(`❌ This ticket is already claimed by ${claimer?.user.toString() || 'someone'}.`);
            }
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: false });
            await message.channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: false });
            await message.channel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            if (ticketOwner) await message.channel.permissionOverwrites.edit(ticketOwner.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            claimedTickets.set(message.channel.id, message.author.id);
            incrementTicketClaimCount(message.author.id);
            const embed = new EmbedBuilder().setTitle('Ticket Claimed').setDescription(`<a:unknown:1495084306781962432> **Ticket claimed by ${message.author.toString()}**\n\nThis ticket is now private.`).setColor(0x00FF00);
            await message.reply({ embeds: [embed] });
        } else if (subCommand === 'transfer') {
            const targetInput = args[1];
            if (!targetInput) return message.reply('❌ Please mention a user to transfer this ticket to. Example: `.ticket transfer @user`');
            if (!message.member.roles.cache.has(supportRoleId)) return message.reply('❌ You need the Support role to transfer tickets.');
            const targetUserId = getUserIdFromInput(targetInput);
            if (!targetUserId) return message.reply('❌ Invalid user.');
            const targetMember = await message.guild.members.fetch(targetUserId).catch(() => null);
            if (!targetMember) return message.reply('❌ Could not find that user.');
            const currentClaimerId = claimedTickets.get(message.channel.id);
            if (currentClaimerId) await message.channel.permissionOverwrites.delete(currentClaimerId);
            await message.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            claimedTickets.set(message.channel.id, targetMember.id);
            const embed = new EmbedBuilder().setTitle('Ticket Transferred').setDescription(`<a:unknown:1495084306781962432> **Ticket transferred to ${targetMember.toString()}**\n\nTransferred by: ${message.author.toString()}`).setColor(0xFFA500);
            await message.reply({ embeds: [embed] });
        } else if (subCommand === 'close') {
            const reason = args.slice(1).join(' ') || 'No reason provided';
            const ticketOwnerId = message.channel.name.replace('ticket-', '');
            const ticketOwnerMember = await message.guild.members.fetch(ticketOwnerId).catch(() => null);
            const claimedById = claimedTickets.get(message.channel.id);
            const claimedByMember = claimedById ? await message.guild.members.fetch(claimedById).catch(() => null) : null;
            const messages = await message.channel.messages.fetch({ limit: 100 });
            const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
            const logChannelId = '1497258421953499146';
            const logChannel = await message.guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const closedAt = Math.floor(Date.now() / 1000);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_transcript_${message.channel.id}`)
                        .setLabel('View Transcript')
                        .setStyle(ButtonStyle.Primary)
                );
                const logEmbed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setDescription(`Closed by ${message.author.toString()}`)
                    .addFields(
                        { name: 'Closed by', value: message.author.tag, inline: true },
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'User', value: ticketOwnerMember ? ticketOwnerMember.user.tag : ticketOwnerId, inline: true },
                        { name: 'Claimed by', value: claimedByMember ? claimedByMember.user.tag : 'Not claimed', inline: true },
                        { name: 'Channel', value: message.channel.name, inline: true },
                        { name: 'Time', value: `<t:${closedAt}:R>`, inline: true }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed], components: [row] });
                if (transcript.length > 0) {
                    storeTicketTranscript(message.channel.id, { transcript, channelName: message.channel.name });
                }
            }
            if (ticketOwnerMember) {
                try {
                    const transcriptBuffer = Buffer.from(transcript, 'utf-8');
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('🎫 Ticket Closed')
                        .setDescription(`Your ticket in **${message.guild.name}** has been closed.`)
                        .addFields(
                            { name: 'Closed by', value: message.author.tag, inline: true },
                            { name: 'Reason', value: reason, inline: true },
                            { name: 'Channel', value: message.channel.name, inline: true }
                        )
                        .setColor(0xFF0000)
                        .setTimestamp();
                    await ticketOwnerMember.send({ embeds: [dmEmbed] });
                } catch (err) {}
            }
            const embed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setDescription(`<a:unknown:1495084306781962432> Ticket closed by ${message.author.toString()}\n**Reason:** ${reason}\n\nThis channel will be deleted in 5 seconds.`)
                .setColor(0xFF0000);
            await message.reply({ embeds: [embed] });
            setTimeout(async () => { try { await message.channel.delete(`Closed by ${message.author.tag}: ${reason}`); } catch (err) {} }, 5000);
        } else {
            return message.reply('Available ticket commands: `.ticket claim`, `.ticket transfer @user`, `.ticket close <reason>`');
        }
    }

    // SAY COMMAND
    if (command === 'say') {
        const OWNER_IDS = ['1413103929931337751', '856260234342039682', '1329319330034221057', '1402004904620327042', '1280573177881297059'];
        if (!OWNER_IDS.includes(message.author.id)) {
            return message.reply(`<:unknown:1495103708957118684> Only the bot owner can use this command.`);
        }
        const sayMessage = args.join(' ');
        if (!sayMessage) return message.reply(`<:unknown:1495103708957118684> Please provide a message to say. Example: \`.say Hello world!\``);
        try {
            await message.delete();
            await message.channel.send(sayMessage);
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to send message.`);
        }
    }

    // ADMIN LIST
    if (command === 'adminlist') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Administrator** permission to view the admin list.`);
        }
        try {
            const adminMembers = [];
            await message.guild.members.fetch();
            for (const [id, member] of message.guild.members.cache) {
                if (member.permissions.has(PermissionFlagsBits.Administrator)) adminMembers.push(member);
            }
            if (adminMembers.length === 0) return message.reply({ embeds: [createErrorEmbed('No Admins', 'No members with Administrator permission found.')] });
            adminMembers.sort((a, b) => b.roles.highest.position - a.roles.highest.position);
            let description = `**Total Administrators:** ${adminMembers.length}\n\n`;
            adminMembers.forEach((member, index) => {
                const highestRole = member.roles.highest.name !== '@everyone' ? member.roles.highest.name : 'No role';
                description += `**${index + 1}.** ${member.user.toString()}\n└ ID: \`${member.id}\` | Role: ${highestRole}\n\n`;
            });
            const embed = new EmbedBuilder().setTitle('👑 Server Administrators').setDescription(description).setColor(0xFF0000).setTimestamp();
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to fetch admin list.`);
        }
    }

    // STATS
    if (command === 'stats') {
        const uptimeMs = Date.now() - startTime;
        const uptimeSeconds = Math.floor(uptimeMs / 1000);
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const totalWarnings = Array.from(warns.values()).reduce((acc, arr) => acc + arr.length, 0);
        const totalForcedNicknames = forcedNicknames.size;
        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Statistics')
            .setDescription(`\`\`\`\n📡 Uptime: ${uptimeString}\n📝 Total Warnings: ${totalWarnings}\n🔒 Forced Nicknames: ${totalForcedNicknames}\n📚 Servers: ${client.guilds.cache.size}\n👥 Users: ${client.users.cache.size}\n🟢 Status: Online\n⏰ Started: ${new Date(startTime).toLocaleString()}\n\`\`\``)
            .setColor(0x00FF00)
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    }

    // USER INFO COMMAND
    if (command === 'user') {
        const targetInput = args[0];
        let targetUser = message.mentions.users.first();
        if (!targetUser && targetInput) {
            const possibleId = getUserIdFromInput(targetInput);
            if (possibleId) {
                targetUser = await client.users.fetch(possibleId).catch(() => null);
            }
        }
        if (!targetUser) targetUser = message.author;

        const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        const nickname = targetMember?.nickname || 'None';
        const highestRole = targetMember ? targetMember.roles.highest.name : 'None';
        const accountCreated = new Date(targetUser.createdTimestamp).toLocaleString();
        const serverJoined = targetMember?.joinedTimestamp ? new Date(targetMember.joinedTimestamp).toLocaleString() : 'Unknown';

        const claimedCount = ticketClaimCounts.get(targetUser.id) || 0;
        const userEmbed = new EmbedBuilder()
            .setTitle('User Information')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
            .setColor(0x5865F2)
            .addFields(
                { name: 'USER ID', value: `\`${targetUser.id}\``, inline: true },
                { name: 'USERNAME', value: `${targetUser.tag}`, inline: true },
                { name: 'SERVER NICKNAME', value: `${nickname}`, inline: true },
                { name: 'BOT', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                { name: 'ACCOUNT CREATED', value: accountCreated, inline: true },
                { name: 'SERVER JOINED', value: serverJoined, inline: true },
                { name: 'HIGHEST ROLE', value: `${highestRole}`, inline: true },
                { name: 'TICKETS CLAIMED', value: `${claimedCount}`, inline: true }
            )
            .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        await message.reply({ embeds: [userEmbed] });
        return;
    }

    // PROMOTE COMMAND
    if (command === 'promote') {
        const targetMention = args[0];
        if (!targetMention) return message.reply('Please mention a user to promote. Example: `.promote @user` or `.promote @user RoleName`');
        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply('Could not find user.');
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('You need **Manage Roles** permission to promote someone.');
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need **Manage Roles** permission to promote someone.');
        const roleInput = args.slice(1).join(' ');
        if (roleInput) {
            const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
            const matchedRoles = allRoles.filter(role => role.name.toLowerCase().includes(roleInput.toLowerCase()));
            if (matchedRoles.size === 0) return message.reply(`Could not find any role matching "${roleInput}".`);
            if (matchedRoles.size > 1) {
                const roleList = matchedRoles.map(r => `- ${r.name}`).join('\n');
                return message.reply(`Multiple roles found matching "${roleInput}":\n${roleList}\n\nPlease be more specific.`);
            }
            const targetRole = matchedRoles.first();
            if (targetMember.roles.cache.has(targetRole.id)) return message.reply(`${targetMember.user.tag} already has the ${targetRole.name} role.`);
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            let oldRoleName = 'None';
            if (userRoles.size > 0) {
                const oldRole = userRoles.sort((a, b) => b.position - a.position).first();
                oldRoleName = oldRole.name;
            }
            const highestBotRole = botMember.roles.highest;
            if (targetRole.position >= highestBotRole.position) return message.reply(`Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to my highest role.`);
            const memberHighestRole = message.member.roles.highest;
            if (targetRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply(`Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to your highest role.`);
            try {
                await targetMember.roles.add(targetRole, `Promoted by ${message.author.tag}`);
                const embed = new EmbedBuilder().setTitle('LawsHub Promotion').setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleName}\n**Current role:** ${targetRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0x00FF00);
                await message.reply({ embeds: [embed] });
            } catch (error) { await message.reply('Failed to promote user.'); }
        } else {
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            if (userRoles.size === 0) return message.reply(`${targetMember.user.tag} has no roles to promote from. Use \`.promote @user RoleName\` to give them a specific role.`);
            const highestUserRole = userRoles.sort((a, b) => b.position - a.position).first();
            const oldRoleName = highestUserRole.name;
            const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
            const sortedRoles = allRoles.sort((a, b) => b.position - a.position);
            let nextRole = null;
            let foundCurrent = false;
            for (const role of sortedRoles.values()) {
                if (foundCurrent) { nextRole = role; break; }
                if (role.id === highestUserRole.id) foundCurrent = true;
            }
            if (!nextRole) return message.reply(`${targetMember.user.tag} already has the highest role in the server!`);
            const highestBotRole = botMember.roles.highest;
            if (nextRole.position >= highestBotRole.position) return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to my highest role.`);
            const memberHighestRole = message.member.roles.highest;
            if (nextRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to your highest role.`);
            try {
                await targetMember.roles.add(nextRole, `Promoted by ${message.author.tag}`);
                const embed = new EmbedBuilder().setTitle('LawsHub Promotion').setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleName}\n**Current role:** ${nextRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0x00FF00);
                await message.reply({ embeds: [embed] });
            } catch (error) { await message.reply('Failed to promote user.'); }
        }
    }

    // DEMOTE COMMAND
    if (command === 'demote') {
        const targetMention = args[0];
        if (!targetMention) return message.reply('Please mention a user to demote. Example: `.demote @user` or `.demote @user RoleName`');
        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply('Could not find user.');
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('You need **Manage Roles** permission to demote someone.');
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need **Manage Roles** permission to demote someone.');
        const roleInput = args.slice(1).join(' ');
        if (roleInput) {
            const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
            const matchedRoles = allRoles.filter(role => role.name.toLowerCase().includes(roleInput.toLowerCase()));
            if (matchedRoles.size === 0) return message.reply(`Could not find any role matching "${roleInput}".`);
            if (matchedRoles.size > 1) {
                const roleList = matchedRoles.map(r => `- ${r.name}`).join('\n');
                return message.reply(`Multiple roles found matching "${roleInput}":\n${roleList}\n\nPlease be more specific.`);
            }
            const targetRole = matchedRoles.first();
            if (!targetMember.roles.cache.has(targetRole.id)) return message.reply(`${targetMember.user.tag} does not have the ${targetRole.name} role.`);
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            const rolesToRemove = userRoles.filter(role => role.position >= targetRole.position);
            if (rolesToRemove.size === 0) return message.reply(`No roles above or equal to ${targetRole.name} to remove.`);
            const removedRoleNames = rolesToRemove.map(role => role.name).join(', ');
            const highestRemovingRole = rolesToRemove.sort((a, b) => b.position - a.position).first();
            const highestBotRole = botMember.roles.highest;
            if (highestRemovingRole.position >= highestBotRole.position) return message.reply(`Cannot remove ${highestRemovingRole.name} - that role is higher than or equal to my highest role.`);
            const memberHighestRole = message.member.roles.highest;
            if (highestRemovingRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply(`Cannot remove ${highestRemovingRole.name} - that role is higher than or equal to your highest role.`);
            try {
                for (const role of rolesToRemove.values()) await targetMember.roles.remove(role, `Demoted by ${message.author.tag}`);
                const embed = new EmbedBuilder().setTitle('LawsHub Demotion').setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Removed Roles:** ${removedRoleNames}\n**Demoted down to:** ${targetRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0xFF0000);
                await message.reply({ embeds: [embed] });
            } catch (error) { await message.reply('Failed to demote user.'); }
        } else {
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            if (userRoles.size === 0) return message.reply(`${targetMember.user.tag} has no roles to demote from.`);
            const lowestUserRole = userRoles.sort((a, b) => a.position - b.position).first();
            const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
            const sortedRoles = allRoles.sort((a, b) => a.position - b.position);
            let roleToGive = null;
            let foundCurrent = false;
            for (const role of sortedRoles.values()) {
                if (foundCurrent) { roleToGive = role; break; }
                if (role.id === lowestUserRole.id) foundCurrent = true;
            }
            if (!roleToGive) return message.reply(`${targetMember.user.tag} already has the lowest role in the server!`);
            try {
                await targetMember.roles.add(roleToGive);
                await targetMember.roles.remove(lowestUserRole);
                const embed = new EmbedBuilder().setTitle('LawsHub Demotion').setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Previous role:** ${lowestUserRole.name}\n**Current role:** ${roleToGive.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0xFF0000);
                await message.reply({ embeds: [embed] });
            } catch (error) { await message.reply('Failed to demote user.'); }
        }
    }

    // FORCENICK COMMAND (.fn)
    if (command === 'fn') {
        const userInput = args[0];
        const newNickname = args.slice(1).join(' ');
        if (!userInput || !newNickname) return message.reply(`<:unknown:1495103708957118684> Please provide a user and nickname. Example: \`.fn @user DesiredNickname\``);
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply(`<:unknown:1495103708957118684> Invalid user ID.`);
        if (userId === message.author.id) return message.reply(`<:unknown:1495103708957118684> You cannot force your own nickname.`);
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply(`<:unknown:1495103708957118684> Could not find that user in the server.`);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply(`<:unknown:1495103708957118684> You need **Manage Nicknames** permission to force a nickname.`);
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply(`<:unknown:1495103708957118684> I need **Manage Nicknames** permission to set nicknames.`);
        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply(`<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`);
        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) return message.reply(`<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`);
        if (newNickname.length > 32) return message.reply(`<:unknown:1495103708957118684> Nickname must be 32 characters or less.`);
        try {
            await targetMember.setNickname(newNickname, `Forced by ${message.author.tag}`);
            forcedNicknames.set(targetMember.id, { nickname: newNickname, moderator: message.author.tag });
            await message.reply(`<a:unknown:1495084306781962432> Forced nicknamed ${targetMember.user.toString()} to **${newNickname}**`);
        } catch (error) { await message.reply(`<:unknown:1495103708957118684> Failed to force nickname.`); }
    }

    // REMOVE FORCENICK COMMAND (.rfn)
    if (command === 'rfn') {
        const userInput = args[0];
        if (!userInput) return message.reply(`<:unknown:1495103708957118684> Please provide a user. Example: \`.rfn @user\``);
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply(`<:unknown:1495103708957118684> Invalid user ID.`);
        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply(`<:unknown:1495103708957118684> You need **Manage Nicknames** permission to remove forced nicknames.`);
        if (!forcedNicknames.has(userId)) return message.reply(`<:unknown:1495103708957118684> This user does not have a forced nickname.`);
        const forcedData = forcedNicknames.get(userId);
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        try {
            forcedNicknames.delete(userId);
            if (targetMember) try { await targetMember.setNickname(null, `Forced nickname removed by ${message.author.tag}`); } catch (nickError) {}
            await message.reply(`<a:unknown:1495084306781962432> Removed forced nickname from ${targetMember ? targetMember.user.toString() : `user ${userId}`} (was **${forcedData.nickname}**)`);
        } catch (error) { await message.reply(`<:unknown:1495103708957118684> Failed to remove forced nickname.`); }
    }

    // CLEAR WARNS COMMAND (.cw)
    if (command === 'cw') {
        const userInput = args[0];
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user to clear warnings. Example: `.cw @user` or `.cw 123456789012345678`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot clear your own warnings.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Administrator** permission to clear warnings.')] });
        if (!warns.has(userId)) return message.reply({ embeds: [createErrorEmbed('Error', 'This user has no warnings to clear.')] });
        const warnCount = warns.get(userId).length;
        warns.delete(userId);
        saveWarnings();
        const embed = createSuccessEmbed('Warnings Cleared', `**User:** <@${userId}>\n**Warnings Removed:** ${warnCount}\n\n**Cleared by:** ${message.author.toString()}`);
        await message.reply({ embeds: [embed] });
    }

    // WIPE COMMAND
    if (command === 'wipe') {
        const targetMention = args[0];
        if (!targetMention) return message.reply('Please mention a user. Example: `.wipe @user`');
        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply('Could not find user.');
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('You need **Manage Roles** permission.');
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need **Manage Roles** permission.');
        const highestTargetRole = targetMember.roles.highest;
        const highestBotRole = botMember.roles.highest;
        if (highestTargetRole.position >= highestBotRole.position && highestTargetRole.name !== '@everyone') return message.reply(`Cannot wipe ${targetMember.user.tag} - they have a role higher than my highest role.`);
        try {
            const rolesToBackup = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            const roleIds = rolesToBackup.map(role => role.id);
            const roleNames = rolesToBackup.map(role => role.name).join(', ') || 'None';
            roleBackups.set(targetMember.id, roleIds);
            await targetMember.roles.set([], `Wiped by ${message.author.tag} (${message.author.id})`);
            const embed = new EmbedBuilder().setTitle('LawsHub Wipe').setDescription(`**User Wiped** ${targetMember.user.toString()}\n\n**Roles Removed:** ${rolesToBackup.size}\n**Removed Roles:** ${roleNames}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0xFFA500);
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply('Failed to wipe roles.'); }
    }

    // UNWIPE COMMAND
    if (command === 'unwipe') {
        const targetMention = args[0];
        if (!targetMention) return message.reply('Please mention a user. Example: `.unwipe @user`');
        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply('Could not find user.');
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('You need **Manage Roles** permission.');
        const backupRoleIds = roleBackups.get(targetMember.id);
        if (!backupRoleIds || backupRoleIds.length === 0) return message.reply(`No wiped roles found for ${targetMember.user.tag}. The bot may have restarted since the wipe.`);
        try {
            const rolesToRestore = [];
            const roleNames = [];
            for (const roleId of backupRoleIds) {
                const role = message.guild.roles.cache.get(roleId);
                if (role) { rolesToRestore.push(role); roleNames.push(role.name); }
            }
            if (rolesToRestore.length === 0) return message.reply('Cannot restore - the original roles no longer exist.');
            await targetMember.roles.add(rolesToRestore, `Restored by ${message.author.tag} (${message.author.id})`);
            roleBackups.delete(targetMember.id);
            const embed = new EmbedBuilder().setTitle('LawsHub Unwipe').setDescription(`**User Unwiped** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.join(', ')}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0x00FF00);
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply('Failed to restore roles.'); }
    }

    // JAIL COMMAND (with confirmation)
    if (command === 'jail') {
        const userInput = args[0];
        const reason = getReason(args.slice(1));
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to jail. Example: `.jail @user reason here`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID or mention.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot jail yourself.')] });
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to jail someone.')] });
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Roles** permission to assign the jail role.')] });
        const jailRoleId = '1495194861530513440';
        const jailRole = message.guild.roles.cache.get(jailRoleId);
        if (!jailRole) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find the jail role.')] });
        const highestBotRole = botMember.roles.highest;
        if (jailRole.position >= highestBotRole.position) return message.reply({ embeds: [createErrorEmbed('Error', 'The jail role is higher than or equal to my highest role.')] });
        if (targetMember.roles.cache.has(jailRole.id)) return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is already jailed!`)] });
        const confirmationId = generateConfirmationId();
        const confirmEmbed = createConfirmationEmbed('jail', targetMember.user, message.author);
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_jail_${confirmationId}`)
                    .setLabel('Confirm Jail')
                    .setEmoji('1501147032104992810')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`confirm_cancel_${confirmationId}`)
                    .setLabel('Abandon Action')
                    .setEmoji('1501148457929281546')
                    .setStyle(ButtonStyle.Danger)
            );
        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });
        pendingActions.set(confirmationId, { action: 'jail', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: message.author.id, originalCommandId: message.id, guildId: message.guild.id, channelId: message.channel.id });
    }

    // UNJAIL COMMAND
    if (command === 'unjail') {
        const targetMention = args[0];
        if (!targetMention) return message.reply('Please mention a user to unjail. Example: `.unjail @user`');
        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply('Could not find user.');
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('You need **Moderate Members** permission to unjail someone.');
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need **Manage Roles** permission to remove the jail role.');
        const jailRoleId = '1495194861530513440';
        const jailRole = message.guild.roles.cache.get(jailRoleId);
        if (!jailRole) return message.reply(`Could not find the jail role.`);
        if (!targetMember.roles.cache.has(jailRole.id)) return message.reply(`${targetMember.user.tag} is not jailed.`);
        try {
            const backupRoleIds = jailBackups.get(targetMember.id);
            const rolesToRestore = [];
            const roleNames = [];
            if (backupRoleIds && backupRoleIds.length > 0) {
                for (const roleId of backupRoleIds) {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role) { rolesToRestore.push(role); roleNames.push(role.name); }
                }
            }
            await targetMember.roles.set(rolesToRestore, `Unjailed by ${message.author.tag} (${message.author.id})`);
            jailBackups.delete(targetMember.id);
            const embed = new EmbedBuilder().setTitle('LawsHub Unjail').setDescription(`**User Unjailed** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.length > 0 ? roleNames.join(', ') : 'None'}\n**Jail Role Removed:** ${jailRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`).setColor(0x00FF00);
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply('Failed to unjail user.'); }
    }

    // LOCK COMMAND
    if (command === 'lock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(`<:unknown:1495103708957118684> You need **Manage Channels** permission to lock channels.`);
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(`<:unknown:1495103708957118684> I need **Manage Channels** permission to lock channels.`);
        let targetChannel = message.mentions.channels.first() || message.channel;
        let reason = getReason(args.slice(targetChannel === message.channel ? 0 : 1), 'No reason provided');
        try {
            if (!channelPermBackups.has(targetChannel.id)) {
                const originalPerms = {};
                const everyoneRole = message.guild.roles.everyone;
                const everyonePerms = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);
                if (everyonePerms) { originalPerms[everyoneRole.id] = { allow: everyonePerms.allow.bitfield.toString(), deny: everyonePerms.deny.bitfield.toString() }; }
                else { originalPerms[everyoneRole.id] = { allow: '0', deny: '0' }; }
                for (const [roleId, overwrite] of targetChannel.permissionOverwrites.cache) {
                    if (roleId !== everyoneRole.id) { originalPerms[roleId] = { allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() }; }
                }
                channelPermBackups.set(targetChannel.id, originalPerms);
            }
            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false });
            const embed = new EmbedBuilder().setTitle('🔒 Channel Locked').setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${message.author.toString()}\n**Reason:** ${reason}\n\nUse \`.unlock\` to restore original permissions.`).setColor(0xFFA500).setTimestamp();
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply(`<:unknown:1495103708957118684> Failed to lock channel.`); }
    }

    // UNLOCK COMMAND
    if (command === 'unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(`<:unknown:1495103708957118684> You need **Manage Channels** permission to unlock channels.`);
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(`<:unknown:1495103708957118684> I need **Manage Channels** permission to unlock channels.`);
        let targetChannel = message.mentions.channels.first() || message.channel;
        let reason = getReason(args.slice(targetChannel === message.channel ? 0 : 1), 'No reason provided');
        try {
            const originalPerms = channelPermBackups.get(targetChannel.id);
            if (originalPerms) {
                const everyoneRole = message.guild.roles.everyone;
                const everyonePerms = originalPerms[everyoneRole.id];
                if (everyonePerms) {
                    await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: everyonePerms.allow.includes('SendMessages') ? true : null, AddReactions: everyonePerms.allow.includes('AddReactions') ? true : null, CreatePublicThreads: everyonePerms.allow.includes('CreatePublicThreads') ? true : null, CreatePrivateThreads: everyonePerms.allow.includes('CreatePrivateThreads') ? true : null, SendMessagesInThreads: everyonePerms.allow.includes('SendMessagesInThreads') ? true : null });
                } else { await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null }); }
                channelPermBackups.delete(targetChannel.id);
            } else { await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null }); }
            const embed = new EmbedBuilder().setTitle('🔓 Channel Unlocked').setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${message.author.toString()}\n**Reason:** ${reason}\n\nOriginal permissions have been restored.`).setColor(0x00FF00).setTimestamp();
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply(`<:unknown:1495103708957118684> Failed to unlock channel.`); }
    }

    // PURGE COMMAND (with auto-delete)
    if (command === 'purge') {
        const amount = parseInt(args[0]);
        if (!amount || isNaN(amount)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number of messages to delete. Example: `.purge 10`')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        if (amount < 1 || amount > 100) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number between 1 and 100.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Manage Messages** permission to purge messages.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Messages** permission to purge messages.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        try {
            const fetched = await message.channel.messages.fetch({ limit: amount });
            const deleted = await message.channel.bulkDelete(fetched, true);
            const embed = createSuccessEmbed('Messages Purged', `**Deleted:** ${deleted.size} messages\n**Channel:** ${message.channel.toString()}\n**Moderator:** ${message.author.toString()}`);
            const sentMsg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => sentMsg.delete().catch(() => {}), 5000);
            await message.delete().catch(() => {});
        } catch (error) {
            console.error(error);
            message.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge messages. Messages may be older than 14 days.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
    }

    // PURGE USER COMMAND (`.purgeuser @user 50`)
    if (command === 'purgeuser') {
        const userInput = args[0];
        const amount = parseInt(args[1]);
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user and provide a number. Example: `.purgeuser @user 50`')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        if (!amount || isNaN(amount)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number of messages to delete. Example: `.purgeuser @user 50`')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        if (amount < 1 || amount > 100) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number between 1 and 100.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Manage Messages** permission to purge messages.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Messages** permission to purge messages.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
        try {
            const fetched = await message.channel.messages.fetch({ limit: 100 });
            const userMessages = fetched.filter(m => m.author.id === userId);
            const toDelete = [...userMessages.values()].slice(0, amount);
            if (toDelete.length === 0) {
                return message.reply({ embeds: [createErrorEmbed('Error', `No messages found from ${targetMember.user.tag} in this channel.`)] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            }
            const deleted = await message.channel.bulkDelete(toDelete, true);
            const embed = createSuccessEmbed('User Messages Purged', `**User:** ${targetMember.user.toString()}\n**Deleted:** ${deleted.size} messages\n**Channel:** ${message.channel.toString()}\n**Moderator:** ${message.author.toString()}`);
            const sentMsg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => sentMsg.delete().catch(() => {}), 5000);
            await message.delete().catch(() => {});
        } catch (error) {
            console.error(error);
            message.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge user messages. Messages may be older than 14 days.')] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }
    }

    // BAN COMMAND (with confirmation)
    if (command === 'ban') {
        const userInput = args[0];
        const reason = getReason(args.slice(1));
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to ban. Example: `.ban @user reason here`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID or mention.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot ban yourself.')] });
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission.')] });
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission.')] });
        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        const confirmationId = generateConfirmationId();
        const confirmEmbed = createConfirmationEmbed('ban', targetMember.user, message.author);
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_ban_${confirmationId}`)
                    .setLabel('Confirm Ban')
                    .setEmoji('1501147032104992810')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`confirm_cancel_${confirmationId}`)
                    .setLabel('Abandon Action')
                    .setEmoji('1501148457929281546')
                    .setStyle(ButtonStyle.Danger)
            );
        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });
        pendingActions.set(confirmationId, { action: 'ban', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: message.author.id, originalCommandId: message.id, guildId: message.guild.id, channelId: message.channel.id });
    }

    // UNBAN COMMAND (with confirmation)
    if (command === 'unban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.unban 123456789012345678`')] });
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);
            if (!banEntry) return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            const unbannedUser = banEntry.user;
            const confirmationId = generateConfirmationId();
            const confirmEmbed = createConfirmationEmbed('unban', unbannedUser, message.author);
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirm_unban_${confirmationId}`)
                        .setLabel('Confirm Unban')
                        .setEmoji('1501147032104992810')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`confirm_cancel_${confirmationId}`)
                        .setLabel('Abandon Action')
                        .setEmoji('1501148457929281546')
                        .setStyle(ButtonStyle.Danger)
                );
            const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });
            pendingActions.set(confirmationId, { action: 'unban', targetUserId: userId, targetUserTag: unbannedUser.tag, reason: 'No reason provided', originalCommandAuthorId: message.author.id, originalCommandId: message.id, guildId: message.guild.id, channelId: message.channel.id });
        } catch (error) { await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to find banned user.')] }); }
    }

    // IUNBAN COMMAND (with confirmation)
    if (command === 'iunban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.iunban 123456789012345678`')] });
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);
            if (!banEntry) return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            const unbannedUser = banEntry.user;
            const confirmationId = generateConfirmationId();
            const confirmEmbed = createConfirmationEmbed('iunban', unbannedUser, message.author);
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirm_iunban_${confirmationId}`)
                        .setLabel('Confirm Unban + DM')
                        .setEmoji('1501147032104992810')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`confirm_cancel_${confirmationId}`)
                        .setLabel('Abandon Action')
                        .setEmoji('1501148457929281546')
                        .setStyle(ButtonStyle.Danger)
                );
            const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });
            pendingActions.set(confirmationId, { action: 'iunban', targetUserId: userId, targetUserTag: unbannedUser.tag, reason: 'No reason provided', originalCommandAuthorId: message.author.id, originalCommandId: message.id, guildId: message.guild.id, channelId: message.channel.id });
        } catch (error) { await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to find banned user.')] }); }
    }

    // KICK COMMAND (with confirmation)
    if (command === 'kick') {
        const userInput = args[0];
        const reason = getReason(args.slice(1));
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to kick. Example: `.kick @user reason here`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID or mention.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot kick yourself.')] });
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Kick Members** permission.')] });
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Kick Members** permission.')] });
        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        const confirmationId = generateConfirmationId();
        const confirmEmbed = createConfirmationEmbed('kick', targetMember.user, message.author);
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_kick_${confirmationId}`)
                    .setLabel('Confirm Kick')
                    .setEmoji('1501147032104992810')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`confirm_cancel_${confirmationId}`)
                    .setLabel('Abandon Action')
                    .setEmoji('1501148457929281546')
                    .setStyle(ButtonStyle.Danger)
            );
        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });
        pendingActions.set(confirmationId, { action: 'kick', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: message.author.id, originalCommandId: message.id, guildId: message.guild.id, channelId: message.channel.id });
    }

    // MUTE COMMAND
    if (command === 'mute') {
        const userInput = args[0];
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to mute. Example: `.mute @user 30s reason here`\n\n**Formats:** s (seconds), m (minutes), h (hours), d (days), w (weeks)')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot mute yourself.')] });
        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to mute someone.')] });
        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to mute someone.')] });
        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot mute ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        let duration = args[1];
        let reasonStart = 2;
        let milliseconds = 0;
        if (!duration || !duration.match(/^\d+[smhdw]$/)) { duration = '10m'; reasonStart = 1; }
        const durationValue = parseInt(duration);
        const durationUnit = duration.slice(-1);
        switch(durationUnit) {
            case 's': milliseconds = durationValue * 1000; break;
            case 'm': milliseconds = durationValue * 60 * 1000; break;
            case 'h': milliseconds = durationValue * 60 * 60 * 1000; break;
            case 'd': milliseconds = durationValue * 24 * 60 * 60 * 1000; break;
            case 'w': milliseconds = durationValue * 7 * 24 * 60 * 60 * 1000; break;
            default: milliseconds = 10 * 60 * 1000;
        }
        const maxMs = 28 * 24 * 60 * 60 * 1000;
        if (milliseconds > maxMs) return message.reply({ embeds: [createErrorEmbed('Error', 'Maximum mute duration is 28 days. Please use a shorter duration.')] });
        const reason = getReason(args.slice(reasonStart));
        let durationText = '';
        if (durationUnit === 's') durationText = `${durationValue} second(s)`;
        else if (durationUnit === 'm') durationText = `${durationValue} minute(s)`;
        else if (durationUnit === 'h') durationText = `${durationValue} hour(s)`;
        else if (durationUnit === 'd') durationText = `${durationValue} day(s)`;
        else if (durationUnit === 'w') durationText = `${durationValue} week(s)`;
        else durationText = `10 minute(s)`;
        try {
            await targetMember.timeout(milliseconds, `Muted by ${message.author.tag}: ${reason}`);
            const embed = createSuccessEmbed('User Muted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Duration:** ${durationText}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to mute user.')] }); }
    }

    // UNMUTE COMMAND
    if (command === 'unmute') {
        const userInput = args[0];
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to unmute. Example: `.unmute @user`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to unmute someone.')] });
        if (!targetMember.isCommunicationDisabled()) return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is not muted.`)] });
        try {
            await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
            const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });
        } catch (error) { await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unmute user.')] }); }
    }

    // WARN COMMAND
    if (command === 'warn') {
        const userInput = args[0];
        if (!userInput) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to warn. Example: `.warn @user reason here`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot warn yourself.')] });
        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to warn someone.')] });
        if (targetMember) {
            const memberHighestRole = message.member.roles.highest;
            const targetHighestRole = targetMember.roles.highest;
            if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot warn ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }
        const reason = getReason(args.slice(1));
        const warnId = Math.floor(Date.now() / 1000).toString();
        const timestamp = new Date().toLocaleString();
        if (!warns.has(userId)) warns.set(userId, []);
        const userName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${userId})`;
        warns.get(userId).push({ id: warnId, reason: reason, moderator: message.author.tag, moderatorId: message.author.id, timestamp: timestamp, userName: userName });
        saveWarnings();
        const warnCount = warns.get(userId).length;
        const actionTaken = await processWarnActions(userId, message.guild, message.author.id);
        let actionMessage = actionTaken ? `\n\n⚠️ **Auto-action triggered at ${warnCount} warnings!**` : '';
        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember ? targetMember.user.toString() : `Unknown User (ID: ${userId})`}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}${actionMessage}`);
        await message.reply({ embeds: [embed] });
    }

    // UNWARN COMMAND
    if (command === 'unwarn') {
        const userInput = args[0];
        const warnId = args[1];
        if (!userInput || !warnId) return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID/mention and a warning ID. Example: `.unwarn @user warningID`')] });
        const userId = getUserIdFromInput(userInput);
        if (!userId) return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        if (userId === message.author.id) return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot remove your own warnings.')] });
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to remove warnings.')] });
        if (!warns.has(userId)) return message.reply({ embeds: [createErrorEmbed('Error', `This user has no warnings.`)] });
        const userWarns = warns.get(userId);
        const warnIndex = userWarns.findIndex(w => w.id === warnId);
        if (warnIndex === -1) return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a warning with ID ${warnId}. Use \`.warns\` to see warning IDs.`)] });
        const removedWarn = userWarns[warnIndex];
        if (removedWarn.moderatorId !== message.author.id && message.member.id !== message.guild.ownerId) return message.reply({ embeds: [createErrorEmbed('Error', `Cannot remove this warning - it was issued by ${removedWarn.moderator}. Only that moderator or an admin can remove it.`)] });
        userWarns.splice(warnIndex, 1);
        if (userWarns.length === 0) warns.delete(userId);
        saveWarnings();
        const embed = createSuccessEmbed('Warning Removed', `**User:** ${removedWarn.userName}\n\n**Removed Warning ID:** ${warnId}\n\n**Original Reason:** ${removedWarn.reason}\n\n**Original Moderator:** ${removedWarn.moderator}\n\n**Removed by:** ${message.author.toString()}\n\n**Remaining Warnings:** ${userWarns.length}`);
        await message.reply({ embeds: [embed] });
    }

    // WARNS COMMAND
    if (command === 'warns') {
        let targetUserId = message.author.id;
        let targetUserName = message.author.tag;
        if (args[0]) {
            const userId = getUserIdFromInput(args[0]);
            if (userId) {
                targetUserId = userId;
                const targetMember = await message.guild.members.fetch(userId).catch(() => null);
                targetUserName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${userId})`;
            }
            if (targetUserId !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to view other users\' warnings.')] });
        }
        const userWarns = warns.get(targetUserId) || [];
        if (userWarns.length === 0) {
            const embed = new EmbedBuilder().setDescription(`**${targetUserName}** has no warnings.`).setColor(0x00FF00).setTimestamp();
            return message.reply({ embeds: [embed] });
        }
        let description = `**${userWarns.length} warning${userWarns.length !== 1 ? 's' : ''} found**\n\n`;
        const sortedWarns = [...userWarns].sort((a, b) => parseInt(b.id) - parseInt(a.id));
        sortedWarns.forEach((warn) => {
            const date = new Date(parseInt(warn.id) * 1000).toLocaleDateString();
            description += `**#${warn.id} | warn | ${date}**\n`;
            description += `Responsible moderator: ${warn.moderator}\n`;
            description += `Reason: ${warn.reason}\n\n`;
        });
        const embed = new EmbedBuilder().setDescription(description).setColor(0xFFA500).setTimestamp();
        await message.reply({ embeds: [embed] });
    }

    // HELP COMMAND
    if (command === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('LawsHub | Help')
            .setDescription(`Prefix : \`.\`\n\n<:2904notifystaff:1497275164818280480>︱AFK\n\`- afk <reason>\`\n\n<:3007link:1497275170631450777>︱Ticket System\n\`- ticket claim\`\n\`- ticket transfer <@user>\`\n\`- ticket close <reason>\`\n\n<:7428whitemember:1497274951521275995>︱Owner \n\`- say\`\n\`- stats\`\n\`- adminlist\`\n\n<:5448staffwhite:1497275091539726418>︱Role Management\n\`- promote\`\n\`- demote\`\n\`- wipe\`\n\`- unwipe\`\n\n<:7240partnerwhite:1497275068265271446>︱Nickname\n\`- fn\`\n\`- rfn\`\n\n<:7964modbadgewhite:1497275047528628314>︱Channel\n\`- lock\`\n\`- unlock\`\n\`- purge\`\n\n<:56832developer:1497274968507941026>︱Punishments\n\`- ban\`\n\`- unban\`\n\`- iunban\`\n\`- kick\`\n\`- mute\`\n\`- unmute\`\n\n<:6304whitesmalldot:1497275082836414675>︱Warning system\n\`- warn\`\n\`- unwarn\`\n\`- warns\`\n\`- cw\`\n\n<:unknown:1501163196021604362>︱Giveaway\n\`- gw create <duration> <winners> <prize>\`\n\`- gw reroll <message_id>\`\n\`- gw end <message_id>\`\n\`- gw list\`\n\n<:unknown:1501163685299884153>︱Purge\n\`- purge <amount>\` - Delete messages\n\`- purgeuser @user <amount>\` - Delete user's messages`)
            .setColor(0x2A017F);
        await message.reply({ embeds: [helpEmbed] });
    }
});

// ========== INTERACTION HANDLER ==========
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand()) {
        const { commandName, options } = interaction;

        switch (commandName) {
            case 'afk': {
                const reason = options.getString('reason') || 'No reason provided';
                const userId = interaction.user.id;
                afkUsers.set(userId, { reason: reason, timestamp: Date.now(), storedMessages: [] });
                try {
                    const currentNick = interaction.member?.nickname || interaction.user.username;
                    if (!currentNick.startsWith('[AFK]')) {
                        await interaction.member.setNickname(`[AFK] ${currentNick.substring(0, 28)}`, 'AFK mode enabled');
                    }
                } catch (err) {}
                const afkEmbed = new EmbedBuilder()
                    .setDescription(`<a:unknown:1495084306781962432> **${interaction.user.username}** is now AFK\n**Reason:** ${reason}`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await interaction.reply({ embeds: [afkEmbed] });
                break;
            }

            case 'gw': {
                const subCommand = options.getSubcommand();
                if (subCommand === 'create') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.reply({ content: '❌ You need **Administrator** permission to start giveaways.', ephemeral: true });
                    }
                    const duration = options.getString('duration');
                    const winnerCount = options.getInteger('winners');
                    const prize = options.getString('prize');
                    if (!duration || !winnerCount || !prize) {
                        const helpEmbed = new EmbedBuilder()
                            .setTitle('<:unknown:1501163196021604362> Giveaway Help ')
                            .setDescription(`**Usage:** /gw create duration: <duration> winners: <winners> prize: <prize>\n\n**Examples:**\n/gw create duration:1h winners:1 prize:Nitro\n/gw create duration:2d winners:3 prize:Discord Nitro\n/gw create duration:30m winners:5 prize:Steam Gift Card\n\n**Duration Formats:**\n\`10s\` - seconds\n\`5m\` - minutes\n\`2h\` - hours\n\`1d\` - days`)
                            .setColor(0x2B017F);
                        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
                    }
                    if (isNaN(winnerCount) || winnerCount < 1 || winnerCount > 25) {
                        return interaction.reply({ content: '❌ Winner count must be between 1 and 25.', ephemeral: true });
                    }
                    const durationMs = parseDuration(duration);
                    if (!durationMs) {
                        return interaction.reply({ content: '❌ Invalid duration format. Use: `10s`, `5m`, `2h`, `1d`', ephemeral: true });
                    }
                    const endTime = Date.now() + durationMs;
                    const giveawayId = Date.now().toString();
                    const timeRemaining = Math.floor(endTime / 1000);
                    const embed = new EmbedBuilder()
                        .setTitle('<:unknown:1501163196021604362> GIVEAWAY')
                        .setDescription(`**Prize:** ${prize}\n**Hosted by:** ${interaction.user.toString()}\n**Entries:** 0\n**Winners:** ${winnerCount}\n\nClick the button below to enter!`)
                        .addFields(
                            { name: '⏰ Time Remaining', value: `<t:${timeRemaining}:R>`, inline: true },
                            { name: '📅 Ends At', value: `<t:${timeRemaining}:F>`, inline: true }
                        )
                        .setColor(0x2B017F)
                        .setTimestamp();
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_${giveawayId}`).setLabel('🎉 Enter Giveaway').setStyle(ButtonStyle.Success));
                    const giveawayMsg = await interaction.channel.send({ embeds: [embed], components: [row] });
                    activeGiveaways.set(giveawayId, {
                        channelId: interaction.channel.id,
                        messageId: giveawayMsg.id,
                        prize: prize,
                        winnerCount: winnerCount,
                        hostId: interaction.user.id,
                        participants: new Set(),
                        endTime: endTime,
                        ended: false,
                        lastUpdate: Date.now(),
                        guildName: interaction.guild.name
                    });
                    saveGiveaways();
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Giveaway Started!')
                        .setDescription(`**Prize:** ${prize}\n**Duration:** ${duration}\n**Winners:** ${winnerCount}\n**Ends:** <t:${timeRemaining}:F>\n\nCheck the giveaway message above to enter!`)
                        .setColor(0x00FF00);
                    await interaction.reply({ embeds: [successEmbed] });
                } else if (subCommand === 'reroll') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.reply({ content: '❌ You need **Administrator** permission to reroll giveaways.', ephemeral: true });
                    }
                    const messageId = options.getString('message_id');
                    if (!messageId) return interaction.reply({ content: '❌ Usage: /gw reroll message_id: <message_id>', ephemeral: true });
                    let foundData = null;
                    for (const [id, data] of endedGiveaways) {
                        if (data.messageId === messageId) { foundData = data; break; }
                    }
                    if (!foundData) return interaction.reply({ content: '❌ Could not find that giveaway.', ephemeral: true });
                    const participants = [...foundData.participants];
                    if (participants.length === 0) return interaction.reply({ content: '❌ No one participated in that giveaway!', ephemeral: true });
                    const shuffled = [...participants];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    const newWinners = shuffled.slice(0, Math.min(foundData.winnerCount, shuffled.length));
                    const winnerMentions = newWinners.map(w => `<@${w}>`).join(', ');
                    const rerollEmbed = new EmbedBuilder().setTitle('🎉 Giveaway Rerolled! 🎉').setDescription(`**Prize:** ${foundData.prize}\n\n**New Winner(s):** ${winnerMentions}\n\n**Total Entries:** ${participants.length}`).setColor(0x00FF00);
                    await interaction.reply({ embeds: [rerollEmbed] });
                } else if (subCommand === 'end') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.reply({ content: '❌ You need **Administrator** permission to end giveaways early.', ephemeral: true });
                    }
                    const messageId = options.getString('message_id');
                    if (!messageId) return interaction.reply({ content: '❌ Usage: /gw end message_id: <message_id>', ephemeral: true });
                    let foundGiveaway = null;
                    let foundData = null;
                    for (const [id, data] of activeGiveaways) {
                        if (data.messageId === messageId) { foundGiveaway = id; foundData = data; break; }
                    }
                    if (!foundData) return interaction.reply({ content: '❌ Could not find that giveaway.', ephemeral: true });
                    if (foundData.ended) return interaction.reply({ content: '❌ That giveaway has already ended.', ephemeral: true });
                    foundData.ended = true;
                    const channel = await interaction.guild.channels.fetch(foundData.channelId);
                    await endGiveaway(foundGiveaway, channel, foundData.messageId, foundData.prize, foundData.winnerCount, foundData.hostId, foundData.participants, foundData.guildName, foundData.endTime, true);
                    saveGiveaways();
                    const endEmbed = new EmbedBuilder().setTitle('✅ Giveaway Ended Early').setDescription(`**Prize:** ${foundData.prize}\n\nGiveaway ended early by ${interaction.user.toString()}. Winners announced above.`).setColor(0xFFA500);
                    await interaction.reply({ embeds: [endEmbed] });
                } else if (subCommand === 'list') {
                    if (activeGiveaways.size === 0 && endedGiveaways.size === 0) return interaction.reply({ content: '❌ There are no giveaways right now.', ephemeral: true });
                    let description = '';
                    if (activeGiveaways.size > 0) {
                        description += '**🟢 Active Giveaways:**\n\n';
                        for (const [id, data] of activeGiveaways) {
                            if (!data.ended) {
                                const endsAt = Math.floor(data.endTime / 1000);
                                description += `**Prize:** ${data.prize}\n**Entries:** ${data.participants.size}\n**Ends:** <t:${endsAt}:R>\n[Jump to giveaway](https://discord.com/channels/${interaction.guild.id}/${data.channelId}/${data.messageId})\n\n`;
                            }
                        }
                    }
                    if (endedGiveaways.size > 0) {
                        description += '\n**🔴 Ended Giveaways (can reroll):**\n\n';
                        let count = 0;
                        for (const [id, data] of endedGiveaways) {
                            if (count < 10) {
                                description += `**Prize:** ${data.prize}\n**Entries:** ${data.participants.size}\n**Message ID:** \`${data.messageId}\`\n\n`;
                                count++;
                            }
                        }
                    }
                    const listEmbed = new EmbedBuilder().setTitle('🎁 Giveaway List 🎁').setDescription(description).setColor(0x2B017F);
                    await interaction.reply({ embeds: [listEmbed] });
                } else if (subCommand === 'help') {
                    const helpEmbed = new EmbedBuilder()
                        .setTitle('🎁 Giveaway Commands 🎁')
                        .setDescription(`**Commands:**\n\n/gw create - Start a giveaway\n/gw reroll - Pick new winners\n/gw end - End giveaway early\n/gw list - List active giveaways\n/gw help - Show this help\n\n**Duration Formats:**\n\`10s\` - seconds\n\`5m\` - minutes\n\`2h\` - hours\n\`1d\` - days`)
                        .setColor(0x2B017F);
                    await interaction.reply({ embeds: [helpEmbed] });
                }
                break;
            }

            case 'ticketpanel': {
                const channel = options.getChannel('channel') || interaction.channel;
                const panelEmbed = new EmbedBuilder().setTitle('LawsHub Support').setDescription('**Please select a button below to open a ticket.**').setColor(0x2B017F);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_script-key').setLabel('Script/Key').setStyle(ButtonStyle.Primary).setEmoji('1497257556295422132'));
                await channel.send({ embeds: [panelEmbed], components: [row] });
                await interaction.reply({ content: `✅ Ticket panel sent to ${channel.toString()}`, ephemeral: true });
                break;
            }

            case 'ticket': {
                const subCommand = options.getSubcommand();
                if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ This command can only be used in a ticket channel.', ephemeral: true });
                const userId = interaction.channel.name.replace('ticket-', '');
                const ticketOwner = await interaction.guild.members.fetch(userId).catch(() => null);
                const supportRoleId = '1495189880760828075';
                if (subCommand === 'claim') {
                    if (!interaction.member.roles.cache.has(supportRoleId)) return interaction.reply({ content: '❌ You need the Support role to claim tickets.', ephemeral: true });
                    if (claimedTickets.has(interaction.channel.id)) {
                        const claimer = await interaction.guild.members.fetch(claimedTickets.get(interaction.channel.id)).catch(() => null);
                        return interaction.reply({ content: `❌ This ticket is already claimed by ${claimer?.user.toString() || 'someone'}.`, ephemeral: true });
                    }
                    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
                    await interaction.channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: false });
                    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    if (ticketOwner) await interaction.channel.permissionOverwrites.edit(ticketOwner.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    claimedTickets.set(interaction.channel.id, interaction.user.id);
                    incrementTicketClaimCount(interaction.user.id);
                    const embed = new EmbedBuilder().setTitle('Ticket Claimed').setDescription(`<a:unknown:1495084306781962432> **Ticket claimed by ${interaction.user.toString()}**\n\nThis ticket is now private.`).setColor(0x00FF00);
                    await interaction.reply({ embeds: [embed] });
                } else if (subCommand === 'transfer') {
                    const targetUser = options.getUser('user');
                    if (!targetUser) return interaction.reply({ content: '❌ Please specify a user to transfer to.', ephemeral: true });
                    if (!interaction.member.roles.cache.has(supportRoleId)) return interaction.reply({ content: '❌ You need the Support role to transfer tickets.', ephemeral: true });
                    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                    if (!targetMember) return interaction.reply({ content: '❌ Could not find that user.', ephemeral: true });
                    const currentClaimerId = claimedTickets.get(interaction.channel.id);
                    if (currentClaimerId) await interaction.channel.permissionOverwrites.delete(currentClaimerId);
                    await interaction.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    claimedTickets.set(interaction.channel.id, targetMember.id);
                    const embed = new EmbedBuilder().setTitle('Ticket Transferred').setDescription(`<a:unknown:1495084306781962432> **Ticket transferred to ${targetMember.toString()}**\n\nTransferred by: ${interaction.user.toString()}`).setColor(0xFFA500);
                    await interaction.reply({ embeds: [embed] });
                } else if (subCommand === 'close') {
                    const reason = options.getString('reason') || 'No reason provided';
                    const ticketOwnerId = interaction.channel.name.replace('ticket-', '');
                    const ticketOwnerMember = await interaction.guild.members.fetch(ticketOwnerId).catch(() => null);
                    const claimedById = claimedTickets.get(interaction.channel.id);
                    const claimedByMember = claimedById ? await interaction.guild.members.fetch(claimedById).catch(() => null) : null;
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
                    const logChannelId = '1497258421953499146';
                    const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const closedAt = Math.floor(Date.now() / 1000);
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ticket_transcript_${interaction.channel.id}`)
                                .setLabel('View Transcript')
                                .setStyle(ButtonStyle.Primary)
                        );
                        const logEmbed = new EmbedBuilder()
                            .setTitle('Ticket Closed')
                            .setDescription(`Closed by ${interaction.user.toString()}`)
                            .addFields(
                                { name: 'Closed by', value: interaction.user.tag, inline: true },
                                { name: 'Reason', value: reason, inline: true },
                                { name: 'User', value: ticketOwnerMember ? ticketOwnerMember.user.tag : ticketOwnerId, inline: true },
                                { name: 'Claimed by', value: claimedByMember ? claimedByMember.user.tag : 'Not claimed', inline: true },
                                { name: 'Channel', value: interaction.channel.name, inline: true },
                                { name: 'Time', value: `<t:${closedAt}:R>`, inline: true }
                            )
                            .setColor(0xFF0000)
                            .setTimestamp();
                        await logChannel.send({ embeds: [logEmbed], components: [row] });
                        if (transcript.length > 0) {
                            storeTicketTranscript(interaction.channel.id, { transcript, channelName: interaction.channel.name });
                        }
                    }
                    if (ticketOwnerMember) {
                        try {
                            const transcriptBuffer = Buffer.from(transcript, 'utf-8');
                            const dmEmbed = new EmbedBuilder()
                                .setTitle('🎫 Ticket Closed')
                                .setDescription(`Your ticket in **${interaction.guild.name}** has been closed.`)
                                .addFields(
                                    { name: 'Closed by', value: interaction.user.tag, inline: true },
                                    { name: 'Reason', value: reason, inline: true },
                                    { name: 'Channel', value: interaction.channel.name, inline: true }
                                )
                                .setColor(0xFF0000)
                                .setTimestamp();
                            await ticketOwnerMember.send({ embeds: [dmEmbed] });
                        } catch (err) {}
                    }
                    const embed = new EmbedBuilder()
                        .setTitle('Ticket Closed')
                        .setDescription(`<a:unknown:1495084306781962432> Ticket closed by ${interaction.user.toString()}\n**Reason:** ${reason}\n\nThis channel will be deleted in 5 seconds.`)
                        .setColor(0xFF0000);
                    await interaction.reply({ embeds: [embed] });
                    setTimeout(async () => { try { await interaction.channel.delete(`Closed by ${interaction.user.tag}: ${reason}`); } catch (err) {} }, 5000);
                }
                break;
            }

            case 'say': {
                const OWNER_IDS = ['1413103929931337751', '856260234342039682', '1329319330034221057', '1402004904620327042', '1280573177881297059'];
                if (!OWNER_IDS.includes(interaction.user.id)) {
                    return interaction.reply({ content: '<:unknown:1495103708957118684> Only the bot owner can use this command.', ephemeral: true });
                }
                const message = options.getString('message');
                if (!message) return interaction.reply({ content: '<:unknown:1495103708957118684> Please provide a message to say. Example: /say Hello world!', ephemeral: true });
                try {
                    await interaction.channel.send(message);
                    await interaction.reply({ content: '<a:unknown:1495084306781962432> Message sent!', ephemeral: true });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to send message.', ephemeral: true });
                }
                break;
            }

            case 'adminlist': {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '<:unknown:1495103708957118684> You need **Administrator** permission to view the admin list.', ephemeral: true });
                }
                try {
                    const adminMembers = [];
                    await interaction.guild.members.fetch();
                    for (const [id, member] of interaction.guild.members.cache) {
                        if (member.permissions.has(PermissionFlagsBits.Administrator)) adminMembers.push(member);
                    }
                    if (adminMembers.length === 0) return interaction.reply({ embeds: [createErrorEmbed('No Admins', 'No members with Administrator permission found.')], ephemeral: true });
                    adminMembers.sort((a, b) => b.roles.highest.position - a.roles.highest.position);
                    let description = `**Total Administrators:** ${adminMembers.length}\n\n`;
                    adminMembers.forEach((member, index) => {
                        const highestRole = member.roles.highest.name !== '@everyone' ? member.roles.highest.name : 'No role';
                        description += `**${index + 1}.** ${member.user.toString()}\n└ ID: \`${member.id}\` | Role: ${highestRole}\n\n`;
                    });
                    const embed = new EmbedBuilder().setTitle('👑 Server Administrators').setDescription(description).setColor(0xFF0000).setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to fetch admin list.', ephemeral: true });
                }
                break;
            }

            case 'stats': {
                const uptimeMs = Date.now() - startTime;
                const uptimeSeconds = Math.floor(uptimeMs / 1000);
                const days = Math.floor(uptimeSeconds / 86400);
                const hours = Math.floor((uptimeSeconds % 86400) / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
                const totalWarnings = Array.from(warns.values()).reduce((acc, arr) => acc + arr.length, 0);
                const totalForcedNicknames = forcedNicknames.size;
                const embed = new EmbedBuilder()
                    .setTitle('📊 Bot Statistics')
                    .setDescription(`\`\`\`\n📡 Uptime: ${uptimeString}\n📝 Total Warnings: ${totalWarnings}\n🔒 Forced Nicknames: ${totalForcedNicknames}\n📚 Servers: ${client.guilds.cache.size}\n👥 Users: ${client.users.cache.size}\n🟢 Status: Online\n⏰ Started: ${new Date(startTime).toLocaleString()}\n\`\`\``)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'promote': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: 'Please mention a user to promote. Example: /promote user:@user', ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: 'Could not find user.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'You need **Manage Roles** permission to promote someone.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'I need **Manage Roles** permission to promote someone.', ephemeral: true });
                const roleName = options.getString('role');
                if (roleName) {
                    const allRoles = interaction.guild.roles.cache.filter(role => role.name !== '@everyone');
                    const matchedRoles = allRoles.filter(role => role.name.toLowerCase().includes(roleName.toLowerCase()));
                    if (matchedRoles.size === 0) return interaction.reply({ content: `Could not find any role matching "${roleName}".`, ephemeral: true });
                    if (matchedRoles.size > 1) {
                        const roleList = matchedRoles.map(r => `- ${r.name}`).join('\n');
                        return interaction.reply({ content: `Multiple roles found matching "${roleName}":\n${roleList}\n\nPlease be more specific.`, ephemeral: true });
                    }
                    const targetRole = matchedRoles.first();
                    if (targetMember.roles.cache.has(targetRole.id)) return interaction.reply({ content: `${targetMember.user.tag} already has the ${targetRole.name} role.`, ephemeral: true });
                    const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                    let oldRoleName = 'None';
                    if (userRoles.size > 0) {
                        const oldRole = userRoles.sort((a, b) => b.position - a.position).first();
                        oldRoleName = oldRole.name;
                    }
                    const highestBotRole = botMember.roles.highest;
                    if (targetRole.position >= highestBotRole.position) return interaction.reply({ content: `Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to my highest role.`, ephemeral: true });
                    const memberHighestRole = interaction.member.roles.highest;
                    if (targetRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ content: `Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to your highest role.`, ephemeral: true });
                    try {
                        await targetMember.roles.add(targetRole, `Promoted by ${interaction.user.tag}`);
                        const embed = new EmbedBuilder().setTitle('LawsHub Promotion').setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleName}\n**Current role:** ${targetRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0x00FF00);
                        await interaction.reply({ embeds: [embed] });
                    } catch (error) { await interaction.reply({ content: 'Failed to promote user.', ephemeral: true }); }
                } else {
                    const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                    if (userRoles.size === 0) return interaction.reply({ content: `${targetMember.user.tag} has no roles to promote from. Use /promote user:@user role:RoleName to give them a specific role.`, ephemeral: true });
                    const highestUserRole = userRoles.sort((a, b) => b.position - a.position).first();
                    const oldRoleName = highestUserRole.name;
                    const allRoles = interaction.guild.roles.cache.filter(role => role.name !== '@everyone');
                    const sortedRoles = allRoles.sort((a, b) => b.position - a.position);
                    let nextRole = null;
                    let foundCurrent = false;
                    for (const role of sortedRoles.values()) {
                        if (foundCurrent) { nextRole = role; break; }
                        if (role.id === highestUserRole.id) foundCurrent = true;
                    }
                    if (!nextRole) return interaction.reply({ content: `${targetMember.user.tag} already has the highest role in the server!`, ephemeral: true });
                    const highestBotRole = botMember.roles.highest;
                    if (nextRole.position >= highestBotRole.position) return interaction.reply({ content: `Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to my highest role.`, ephemeral: true });
                    const memberHighestRole = interaction.member.roles.highest;
                    if (nextRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ content: `Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to your highest role.`, ephemeral: true });
                    try {
                        await targetMember.roles.add(nextRole, `Promoted by ${interaction.user.tag}`);
                        const embed = new EmbedBuilder().setTitle('LawsHub Promotion').setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleName}\n**Current role:** ${nextRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0x00FF00);
                        await interaction.reply({ embeds: [embed] });
                    } catch (error) { await interaction.reply({ content: 'Failed to promote user.', ephemeral: true }); }
                }
                break;
            }

            case 'demote': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: 'Please mention a user to demote. Example: /demote user:@user', ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: 'Could not find user.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'You need **Manage Roles** permission to demote someone.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'I need **Manage Roles** permission to demote someone.', ephemeral: true });
                const roleName = options.getString('role');
                if (roleName) {
                    const allRoles = interaction.guild.roles.cache.filter(role => role.name !== '@everyone');
                    const matchedRoles = allRoles.filter(role => role.name.toLowerCase().includes(roleName.toLowerCase()));
                    if (matchedRoles.size === 0) return interaction.reply({ content: `Could not find any role matching "${roleName}".`, ephemeral: true });
                    if (matchedRoles.size > 1) {
                        const roleList = matchedRoles.map(r => `- ${r.name}`).join('\n');
                        return interaction.reply({ content: `Multiple roles found matching "${roleName}":\n${roleList}\n\nPlease be more specific.`, ephemeral: true });
                    }
                    const targetRole = matchedRoles.first();
                    if (!targetMember.roles.cache.has(targetRole.id)) return interaction.reply({ content: `${targetMember.user.tag} does not have the ${targetRole.name} role.`, ephemeral: true });
                    const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                    const rolesToRemove = userRoles.filter(role => role.position >= targetRole.position);
                    if (rolesToRemove.size === 0) return interaction.reply({ content: `No roles above or equal to ${targetRole.name} to remove.`, ephemeral: true });
                    const removedRoleNames = rolesToRemove.map(role => role.name).join(', ');
                    const highestRemovingRole = rolesToRemove.sort((a, b) => b.position - a.position).first();
                    const highestBotRole = botMember.roles.highest;
                    if (highestRemovingRole.position >= highestBotRole.position) return interaction.reply({ content: `Cannot remove ${highestRemovingRole.name} - that role is higher than or equal to my highest role.`, ephemeral: true });
                    const memberHighestRole = interaction.member.roles.highest;
                    if (highestRemovingRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ content: `Cannot remove ${highestRemovingRole.name} - that role is higher than or equal to your highest role.`, ephemeral: true });
                    try {
                        for (const role of rolesToRemove.values()) await targetMember.roles.remove(role, `Demoted by ${interaction.user.tag}`);
                        const embed = new EmbedBuilder().setTitle('LawsHub Demotion').setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Removed Roles:** ${removedRoleNames}\n**Demoted down to:** ${targetRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0xFF0000);
                        await interaction.reply({ embeds: [embed] });
                    } catch (error) { await interaction.reply({ content: 'Failed to demote user.', ephemeral: true }); }
                } else {
                    const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                    if (userRoles.size === 0) return interaction.reply({ content: `${targetMember.user.tag} has no roles to demote from.`, ephemeral: true });
                    const lowestUserRole = userRoles.sort((a, b) => a.position - b.position).first();
                    const allRoles = interaction.guild.roles.cache.filter(role => role.name !== '@everyone');
                    const sortedRoles = allRoles.sort((a, b) => a.position - b.position);
                    let roleToGive = null;
                    let foundCurrent = false;
                    for (const role of sortedRoles.values()) {
                        if (foundCurrent) { roleToGive = role; break; }
                        if (role.id === lowestUserRole.id) foundCurrent = true;
                    }
                    if (!roleToGive) return interaction.reply({ content: `${targetMember.user.tag} already has the lowest role in the server!`, ephemeral: true });
                    try {
                        await targetMember.roles.add(roleToGive);
                        await targetMember.roles.remove(lowestUserRole);
                        const embed = new EmbedBuilder().setTitle('LawsHub Demotion').setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Previous role:** ${lowestUserRole.name}\n**Current role:** ${roleToGive.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0xFF0000);
                        await interaction.reply({ embeds: [embed] });
                    } catch (error) { await interaction.reply({ content: 'Failed to demote user.', ephemeral: true }); }
                }
                break;
            }

            case 'fn': {
                const targetUser = options.getUser('user');
                const newNickname = options.getString('nickname');
                if (!targetUser || !newNickname) return interaction.reply({ content: '<:unknown:1495103708957118684> Please provide a user and nickname. Example: /fn user:@user nickname:DesiredNickname', ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ content: '<:unknown:1495103708957118684> You cannot force your own nickname.', ephemeral: true });
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: '<:unknown:1495103708957118684> Could not find that user in the server.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) return interaction.reply({ content: '<:unknown:1495103708957118684> You need **Manage Nicknames** permission to force a nickname.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) return interaction.reply({ content: '<:unknown:1495103708957118684> I need **Manage Nicknames** permission to set nicknames.', ephemeral: true });
                const memberHighestRole = interaction.member.roles.highest;
                const targetHighestRole = targetMember.roles.highest;
                if (targetHighestRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ content: '<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to your highest role.', ephemeral: true });
                const botHighestRole = botMember.roles.highest;
                if (targetHighestRole.position >= botHighestRole.position) return interaction.reply({ content: '<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to my highest role.', ephemeral: true });
                if (newNickname.length > 32) return interaction.reply({ content: '<:unknown:1495103708957118684> Nickname must be 32 characters or less.', ephemeral: true });
                try {
                    await targetMember.setNickname(newNickname, `Forced by ${interaction.user.tag}`);
                    forcedNicknames.set(targetMember.id, { nickname: newNickname, moderator: interaction.user.tag });
                    await interaction.reply({ content: `<a:unknown:1495084306781962432> Forced nicknamed ${targetMember.user.toString()} to **${newNickname}**` });
                } catch (error) { await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to force nickname.', ephemeral: true }); }
                break;
            }

            case 'rfn': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: '<:unknown:1495103708957118684> Please provide a user. Example: /rfn user:@user', ephemeral: true });
                const userId = targetUser.id;
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) return interaction.reply({ content: '<:unknown:1495103708957118684> You need **Manage Nicknames** permission to remove forced nicknames.', ephemeral: true });
                if (!forcedNicknames.has(userId)) return interaction.reply({ content: '<:unknown:1495103708957118684> This user does not have a forced nickname.', ephemeral: true });
                const forcedData = forcedNicknames.get(userId);
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                try {
                    forcedNicknames.delete(userId);
                    if (targetMember) try { await targetMember.setNickname(null, `Forced nickname removed by ${interaction.user.tag}`); } catch (nickError) {}
                    await interaction.reply({ content: `<a:unknown:1495084306781962432> Removed forced nickname from ${targetMember ? targetMember.user.toString() : `user ${userId}`} (was **${forcedData.nickname}**)` });
                } catch (error) { await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to remove forced nickname.', ephemeral: true }); }
                break;
            }

            case 'cw': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user to clear warnings. Example: /cw user:@user')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot clear your own warnings.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Administrator** permission to clear warnings.')], ephemeral: true });
                if (!warns.has(userId)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'This user has no warnings to clear.')], ephemeral: true });
                const warnCount = warns.get(userId).length;
                warns.delete(userId);
                saveWarnings();
                const embed = createSuccessEmbed('Warnings Cleared', `**User:** <@${userId}>\n**Warnings Removed:** ${warnCount}\n\n**Cleared by:** ${interaction.user.toString()}`);
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'wipe': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: 'Please mention a user. Example: /wipe user:@user', ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: 'Could not find user.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'You need **Manage Roles** permission.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'I need **Manage Roles** permission.', ephemeral: true });
                const highestTargetRole = targetMember.roles.highest;
                const highestBotRole = botMember.roles.highest;
                if (highestTargetRole.position >= highestBotRole.position && highestTargetRole.name !== '@everyone') return interaction.reply({ content: `Cannot wipe ${targetMember.user.tag} - they have a role higher than my highest role.`, ephemeral: true });
                try {
                    const rolesToBackup = targetMember.roles.cache.filter(role => role.name !== '@everyone');
                    const roleIds = rolesToBackup.map(role => role.id);
                    const roleNames = rolesToBackup.map(role => role.name).join(', ') || 'None';
                    roleBackups.set(targetMember.id, roleIds);
                    await targetMember.roles.set([], `Wiped by ${interaction.user.tag} (${interaction.user.id})`);
                    const embed = new EmbedBuilder().setTitle('LawsHub Wipe').setDescription(`**User Wiped** ${targetMember.user.toString()}\n\n**Roles Removed:** ${rolesToBackup.size}\n**Removed Roles:** ${roleNames}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0xFFA500);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ content: 'Failed to wipe roles.', ephemeral: true }); }
                break;
            }

            case 'unwipe': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: 'Please mention a user. Example: /unwipe user:@user', ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: 'Could not find user.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'You need **Manage Roles** permission.', ephemeral: true });
                const backupRoleIds = roleBackups.get(targetMember.id);
                if (!backupRoleIds || backupRoleIds.length === 0) return interaction.reply({ content: `No wiped roles found for ${targetMember.user.tag}. The bot may have restarted since the wipe.`, ephemeral: true });
                try {
                    const rolesToRestore = [];
                    const roleNames = [];
                    for (const roleId of backupRoleIds) {
                        const role = interaction.guild.roles.cache.get(roleId);
                        if (role) { rolesToRestore.push(role); roleNames.push(role.name); }
                    }
                    if (rolesToRestore.length === 0) return interaction.reply({ content: 'Cannot restore - the original roles no longer exist.', ephemeral: true });
                    await targetMember.roles.add(rolesToRestore, `Restored by ${interaction.user.tag} (${interaction.user.id})`);
                    roleBackups.delete(targetMember.id);
                    const embed = new EmbedBuilder().setTitle('LawsHub Unwipe').setDescription(`**User Unwiped** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.join(', ')}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0x00FF00);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ content: 'Failed to restore roles.', ephemeral: true }); }
                break;
            }

            case 'jail': {
                const targetUser = options.getUser('user');
                const reason = options.getString('reason') || 'No reason provided';
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to jail. Example: /jail user:@user reason:reason here')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot jail yourself.')], ephemeral: true });
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to jail someone.')], ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Roles** permission to assign the jail role.')], ephemeral: true });
                const jailRoleId = '1495194861530513440';
                const jailRole = interaction.guild.roles.cache.get(jailRoleId);
                if (!jailRole) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find the jail role.')], ephemeral: true });
                const highestBotRole = botMember.roles.highest;
                if (jailRole.position >= highestBotRole.position) return interaction.reply({ embeds: [createErrorEmbed('Error', 'The jail role is higher than or equal to my highest role.')], ephemeral: true });
                if (targetMember.roles.cache.has(jailRole.id)) return interaction.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is already jailed!`)], ephemeral: true });
                const confirmationId = generateConfirmationId();
                const confirmEmbed = createConfirmationEmbed('jail', targetMember.user, interaction.user);
                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_jail_${confirmationId}`)
                            .setLabel('Confirm Jail')
                            .setEmoji('1501147032104992810')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`confirm_cancel_${confirmationId}`)
                            .setLabel('Abandon Action')
                            .setEmoji('1501148457929281546')
                            .setStyle(ButtonStyle.Danger)
                    );
                pendingActions.set(confirmationId, { action: 'jail', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: interaction.user.id, originalCommandId: null, guildId: interaction.guild.id, channelId: interaction.channel.id });
                await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
                break;
            }

            case 'unjail': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ content: 'Please mention a user to unjail. Example: /unjail user:@user', ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ content: 'Could not find user.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'You need **Moderate Members** permission to unjail someone.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'I need **Manage Roles** permission to remove the jail role.', ephemeral: true });
                const jailRoleId = '1495194861530513440';
                const jailRole = interaction.guild.roles.cache.get(jailRoleId);
                if (!jailRole) return interaction.reply({ content: `Could not find the jail role.`, ephemeral: true });
                if (!targetMember.roles.cache.has(jailRole.id)) return interaction.reply({ content: `${targetMember.user.tag} is not jailed.`, ephemeral: true });
                try {
                    const backupRoleIds = jailBackups.get(targetMember.id);
                    const rolesToRestore = [];
                    const roleNames = [];
                    if (backupRoleIds && backupRoleIds.length > 0) {
                        for (const roleId of backupRoleIds) {
                            const role = interaction.guild.roles.cache.get(roleId);
                            if (role) { rolesToRestore.push(role); roleNames.push(role.name); }
                        }
                    }
                    await targetMember.roles.set(rolesToRestore, `Unjailed by ${interaction.user.tag} (${interaction.user.id})`);
                    jailBackups.delete(targetMember.id);
                    const embed = new EmbedBuilder().setTitle('LawsHub Unjail').setDescription(`**User Unjailed** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.length > 0 ? roleNames.join(', ') : 'None'}\n**Jail Role Removed:** ${jailRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${interaction.user.toString()}`).setColor(0x00FF00);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ content: 'Failed to unjail user.', ephemeral: true }); }
                break;
            }

            case 'lock': {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '<:unknown:1495103708957118684> You need **Manage Channels** permission to lock channels.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '<:unknown:1495103708957118684> I need **Manage Channels** permission to lock channels.', ephemeral: true });
                let targetChannel = options.getChannel('channel') || interaction.channel;
                let reason = options.getString('reason') || 'No reason provided';
                try {
                    if (!channelPermBackups.has(targetChannel.id)) {
                        const originalPerms = {};
                        const everyoneRole = interaction.guild.roles.everyone;
                        const everyonePerms = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);
                        if (everyonePerms) { originalPerms[everyoneRole.id] = { allow: everyonePerms.allow.bitfield.toString(), deny: everyonePerms.deny.bitfield.toString() }; }
                        else { originalPerms[everyoneRole.id] = { allow: '0', deny: '0' }; }
                        for (const [roleId, overwrite] of targetChannel.permissionOverwrites.cache) {
                            if (roleId !== everyoneRole.id) { originalPerms[roleId] = { allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() }; }
                        }
                        channelPermBackups.set(targetChannel.id, originalPerms);
                    }
                    await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false });
                    const embed = new EmbedBuilder().setTitle('🔒 Channel Locked').setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${interaction.user.toString()}\n**Reason:** ${reason}\n\nUse /unlock to restore original permissions.`).setColor(0xFFA500).setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to lock channel.', ephemeral: true }); }
                break;
            }

            case 'unlock': {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '<:unknown:1495103708957118684> You need **Manage Channels** permission to unlock channels.', ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '<:unknown:1495103708957118684> I need **Manage Channels** permission to unlock channels.', ephemeral: true });
                let targetChannel = options.getChannel('channel') || interaction.channel;
                let reason = options.getString('reason') || 'No reason provided';
                try {
                    const originalPerms = channelPermBackups.get(targetChannel.id);
                    if (originalPerms) {
                        const everyoneRole = interaction.guild.roles.everyone;
                        const everyonePerms = originalPerms[everyoneRole.id];
                        if (everyonePerms) {
                            await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: everyonePerms.allow.includes('SendMessages') ? true : null, AddReactions: everyonePerms.allow.includes('AddReactions') ? true : null, CreatePublicThreads: everyonePerms.allow.includes('CreatePublicThreads') ? true : null, CreatePrivateThreads: everyonePerms.allow.includes('CreatePrivateThreads') ? true : null, SendMessagesInThreads: everyonePerms.allow.includes('SendMessagesInThreads') ? true : null });
                        } else { await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null }); }
                        channelPermBackups.delete(targetChannel.id);
                    } else { await targetChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null, AddReactions: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null }); }
                    const embed = new EmbedBuilder().setTitle('🔓 Channel Unlocked').setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${interaction.user.toString()}\n**Reason:** ${reason}\n\nOriginal permissions have been restored.`).setColor(0x00FF00).setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ content: '<:unknown:1495103708957118684> Failed to unlock channel.', ephemeral: true }); }
                break;
            }

            case 'purge': {
                const amount = options.getInteger('amount');
                if (!amount || isNaN(amount)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number of messages to delete. Example: /purge amount:10')], ephemeral: true });
                }
                if (amount < 1 || amount > 100) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number between 1 and 100.')], ephemeral: true });
                }
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Manage Messages** permission to purge messages.')], ephemeral: true });
                }
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Messages** permission to purge messages.')], ephemeral: true });
                }
                try {
                    const fetched = await interaction.channel.messages.fetch({ limit: amount });
                    const deleted = await interaction.channel.bulkDelete(fetched, true);
                    const embed = createSuccessEmbed('Messages Purged', `**Deleted:** ${deleted.size} messages\n**Channel:** ${interaction.channel.toString()}\n**Moderator:** ${interaction.user.toString()}`);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge messages. Messages may be older than 14 days.')], ephemeral: true });
                }
                break;
            }

            case 'purgeuser': {
                const targetUser = options.getUser('user');
                const amount = options.getInteger('amount');
                if (!targetUser) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user and provide a number. Example: /purgeuser user:@user amount:50')], ephemeral: true });
                }
                if (!amount || isNaN(amount)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number of messages to delete. Example: /purgeuser user:@user amount:50')], ephemeral: true });
                }
                if (amount < 1 || amount > 100) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number between 1 and 100.')], ephemeral: true });
                }
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Manage Messages** permission to purge messages.')], ephemeral: true });
                }
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Messages** permission to purge messages.')], ephemeral: true });
                }
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) {
                    return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')], ephemeral: true });
                }
                try {
                    const fetched = await interaction.channel.messages.fetch({ limit: 100 });
                    const userMessages = fetched.filter(m => m.author.id === userId);
                    const toDelete = [...userMessages.values()].slice(0, amount);
                    if (toDelete.length === 0) {
                        return interaction.reply({ embeds: [createErrorEmbed('Error', `No messages found from ${targetMember.user.tag} in this channel.`)], ephemeral: true });
                    }
                    const deleted = await interaction.channel.bulkDelete(toDelete, true);
                    const embed = createSuccessEmbed('User Messages Purged', `**User:** ${targetMember.user.toString()}\n**Deleted:** ${deleted.size} messages\n**Channel:** ${interaction.channel.toString()}\n**Moderator:** ${interaction.user.toString()}`);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge user messages. Messages may be older than 14 days.')], ephemeral: true });
                }
                break;
            }

            case 'ban': {
                const targetUser = options.getUser('user');
                const reason = options.getString('reason') || 'No reason provided';
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to ban. Example: /ban user:@user reason:reason here')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot ban yourself.')], ephemeral: true });
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission.')], ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission.')], ephemeral: true });
                const memberHighestRole = interaction.member.roles.highest;
                const targetHighestRole = targetMember.roles.highest;
                if (targetHighestRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)], ephemeral: true });
                const botHighestRole = botMember.roles.highest;
                if (targetHighestRole.position >= botHighestRole.position) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)], ephemeral: true });
                const confirmationId = generateConfirmationId();
                const confirmEmbed = createConfirmationEmbed('ban', targetMember.user, interaction.user);
                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_ban_${confirmationId}`)
                            .setLabel('Confirm Ban')
                            .setEmoji('1501147032104992810')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`confirm_cancel_${confirmationId}`)
                            .setLabel('Abandon Action')
                            .setEmoji('1501148457929281546')
                            .setStyle(ButtonStyle.Danger)
                    );
                pendingActions.set(confirmationId, { action: 'ban', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: interaction.user.id, originalCommandId: null, guildId: interaction.guild.id, channelId: interaction.channel.id });
                await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
                break;
            }

            case 'unban': {
                const userId = options.getString('user');
                if (!userId) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: /unban user:123456789012345678')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')], ephemeral: true });
                try {
                    const bans = await interaction.guild.bans.fetch();
                    const banEntry = bans.get(userId);
                    if (!banEntry) return interaction.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)], ephemeral: true });
                    const unbannedUser = banEntry.user;
                    const confirmationId = generateConfirmationId();
                    const confirmEmbed = createConfirmationEmbed('unban', unbannedUser, interaction.user);
                    const confirmRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`confirm_unban_${confirmationId}`)
                                .setLabel('Confirm Unban')
                                .setEmoji('1501147032104992810')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`confirm_cancel_${confirmationId}`)
                                .setLabel('Abandon Action')
                                .setEmoji('1501148457929281546')
                                .setStyle(ButtonStyle.Danger)
                        );
                    pendingActions.set(confirmationId, { action: 'unban', targetUserId: userId, targetUserTag: unbannedUser.tag, reason: 'No reason provided', originalCommandAuthorId: interaction.user.id, originalCommandId: null, guildId: interaction.guild.id, channelId: interaction.channel.id });
                    await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
                } catch (error) { await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to find banned user.')], ephemeral: true }); }
                break;
            }

            case 'iunban': {
                const userId = options.getString('user');
                if (!userId) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: /iunban user:123456789012345678')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')], ephemeral: true });
                try {
                    const bans = await interaction.guild.bans.fetch();
                    const banEntry = bans.get(userId);
                    if (!banEntry) return interaction.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)], ephemeral: true });
                    const unbannedUser = banEntry.user;
                    const confirmationId = generateConfirmationId();
                    const confirmEmbed = createConfirmationEmbed('iunban', unbannedUser, interaction.user);
                    const confirmRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`confirm_iunban_${confirmationId}`)
                                .setLabel('Confirm Unban + DM')
                                .setEmoji('1501147032104992810')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`confirm_cancel_${confirmationId}`)
                                .setLabel('Abandon Action')
                                .setEmoji('1501148457929281546')
                                .setStyle(ButtonStyle.Danger)
                        );
                    pendingActions.set(confirmationId, { action: 'iunban', targetUserId: userId, targetUserTag: unbannedUser.tag, reason: 'No reason provided', originalCommandAuthorId: interaction.user.id, originalCommandId: null, guildId: interaction.guild.id, channelId: interaction.channel.id });
                    await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
                } catch (error) { await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to find banned user.')], ephemeral: true }); }
                break;
            }

            case 'kick': {
                const targetUser = options.getUser('user');
                const reason = options.getString('reason') || 'No reason provided';
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to kick. Example: /kick user:@user reason:reason here')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot kick yourself.')], ephemeral: true });
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Kick Members** permission.')], ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Kick Members** permission.')], ephemeral: true });
                const memberHighestRole = interaction.member.roles.highest;
                const targetHighestRole = targetMember.roles.highest;
                if (targetHighestRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)], ephemeral: true });
                const botHighestRole = botMember.roles.highest;
                if (targetHighestRole.position >= botHighestRole.position) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)], ephemeral: true });
                const confirmationId = generateConfirmationId();
                const confirmEmbed = createConfirmationEmbed('kick', targetMember.user, interaction.user);
                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_kick_${confirmationId}`)
                            .setLabel('Confirm Kick')
                            .setEmoji('1501147032104992810')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`confirm_cancel_${confirmationId}`)
                            .setLabel('Abandon Action')
                            .setEmoji('1501148457929281546')
                            .setStyle(ButtonStyle.Danger)
                    );
                pendingActions.set(confirmationId, { action: 'kick', targetUserId: userId, targetUserTag: targetMember.user.tag, reason: reason, originalCommandAuthorId: interaction.user.id, originalCommandId: null, guildId: interaction.guild.id, channelId: interaction.channel.id });
                await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow] });
                break;
            }

            case 'mute': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to mute. Example: /mute user:@user duration:30m reason:reason here\n\n**Formats:** s (seconds), m (minutes), h (hours), d (days), w (weeks)')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot mute yourself.')], ephemeral: true });
                let targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to mute someone.')], ephemeral: true });
                const botMember = await interaction.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to mute someone.')], ephemeral: true });
                const memberHighestRole = interaction.member.roles.highest;
                const targetHighestRole = targetMember.roles.highest;
                if (targetHighestRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot mute ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)], ephemeral: true });
                let duration = options.getString('duration');
                let reason = options.getString('reason') || 'No reason provided';
                let milliseconds = 0;
                if (!duration || !duration.match(/^\d+[smhdw]$/)) { duration = '10m'; }
                const durationValue = parseInt(duration);
                const durationUnit = duration.slice(-1);
                switch(durationUnit) {
                    case 's': milliseconds = durationValue * 1000; break;
                    case 'm': milliseconds = durationValue * 60 * 1000; break;
                    case 'h': milliseconds = durationValue * 60 * 60 * 1000; break;
                    case 'd': milliseconds = durationValue * 24 * 60 * 60 * 1000; break;
                    case 'w': milliseconds = durationValue * 7 * 24 * 60 * 60 * 1000; break;
                    default: milliseconds = 10 * 60 * 1000;
                }
                const maxMs = 28 * 24 * 60 * 60 * 1000;
                if (milliseconds > maxMs) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Maximum mute duration is 28 days. Please use a shorter duration.')], ephemeral: true });
                let durationText = '';
                if (durationUnit === 's') durationText = `${durationValue} second(s)`;
                else if (durationUnit === 'm') durationText = `${durationValue} minute(s)`;
                else if (durationUnit === 'h') durationText = `${durationValue} hour(s)`;
                else if (durationUnit === 'd') durationText = `${durationValue} day(s)`;
                else if (durationUnit === 'w') durationText = `${durationValue} week(s)`;
                else durationText = `10 minute(s)`;
                try {
                    await targetMember.timeout(milliseconds, `Muted by ${interaction.user.tag}: ${reason}`);
                    const embed = createSuccessEmbed('User Muted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${interaction.user.toString()}\n\n**Duration:** ${durationText}\n\n**Reason:** ${reason}`);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to mute user.')], ephemeral: true }); }
                break;
            }

            case 'unmute': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to unmute. Example: /unmute user:@user')], ephemeral: true });
                const userId = targetUser.id;
                const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!targetMember) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to unmute someone.')], ephemeral: true });
                if (!targetMember.isCommunicationDisabled()) return interaction.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is not muted.`)], ephemeral: true });
                try {
                    await targetMember.timeout(null, `Unmuted by ${interaction.user.tag}`);
                    const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${interaction.user.toString()}`);
                    await interaction.reply({ embeds: [embed] });
                } catch (error) { await interaction.reply({ embeds: [createErrorEmbed('Error', 'Failed to unmute user.')], ephemeral: true }); }
                break;
            }

            case 'warn': {
                const targetUser = options.getUser('user');
                if (!targetUser) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to warn. Example: /warn user:@user reason:reason here')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot warn yourself.')], ephemeral: true });
                let targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to warn someone.')], ephemeral: true });
                if (targetMember) {
                    const memberHighestRole = interaction.member.roles.highest;
                    const targetHighestRole = targetMember.roles.highest;
                    if (targetHighestRole.position >= memberHighestRole.position && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot warn ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)], ephemeral: true });
                }
                const reason = options.getString('reason') || 'No reason provided';
                const warnId = Math.floor(Date.now() / 1000).toString();
                const timestamp = new Date().toLocaleString();
                if (!warns.has(userId)) warns.set(userId, []);
                const userName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${userId})`;
                warns.get(userId).push({ id: warnId, reason: reason, moderator: interaction.user.tag, moderatorId: interaction.user.id, timestamp: timestamp, userName: userName });
                saveWarnings();
                const warnCount = warns.get(userId).length;
                const actionTaken = await processWarnActions(userId, interaction.guild, interaction.user.id);
                let actionMessage = actionTaken ? `\n\n⚠️ **Auto-action triggered at ${warnCount} warnings!**` : '';
                const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember ? targetMember.user.toString() : `Unknown User (ID: ${userId})`}\n\n**Moderator:** ${interaction.user.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}${actionMessage}`);
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'unwarn': {
                const targetUser = options.getUser('user');
                const warnId = options.getString('warn_id');
                if (!targetUser || !warnId) return interaction.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID/mention and a warning ID. Example: /unwarn user:@user warn_id:warningID')], ephemeral: true });
                const userId = targetUser.id;
                if (userId === interaction.user.id) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You cannot remove your own warnings.')], ephemeral: true });
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to remove warnings.')], ephemeral: true });
                if (!warns.has(userId)) return interaction.reply({ embeds: [createErrorEmbed('Error', `This user has no warnings.`)] , ephemeral: true });
                const userWarns = warns.get(userId);
                const warnIndex = userWarns.findIndex(w => w.id === warnId);
                if (warnIndex === -1) return interaction.reply({ embeds: [createErrorEmbed('Error', `Could not find a warning with ID ${warnId}. Use /warns to see warning IDs.`)] , ephemeral: true });
                const removedWarn = userWarns[warnIndex];
                if (removedWarn.moderatorId !== interaction.user.id && interaction.member.id !== interaction.guild.ownerId) return interaction.reply({ embeds: [createErrorEmbed('Error', `Cannot remove this warning - it was issued by ${removedWarn.moderator}. Only that moderator or an admin can remove it.`)] , ephemeral: true });
                userWarns.splice(warnIndex, 1);
                if (userWarns.length === 0) warns.delete(userId);
                saveWarnings();
                const embed = createSuccessEmbed('Warning Removed', `**User:** ${removedWarn.userName}\n\n**Removed Warning ID:** ${warnId}\n\n**Original Reason:** ${removedWarn.reason}\n\n**Original Moderator:** ${removedWarn.moderator}\n\n**Removed by:** ${interaction.user.toString()}\n\n**Remaining Warnings:** ${userWarns.length}`);
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'warns': {
                let targetUserId = interaction.user.id;
                let targetUserName = interaction.user.tag;
                const targetUser = options.getUser('user');
                if (targetUser) {
                    targetUserId = targetUser.id;
                    const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
                    targetUserName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${targetUserId})`;
                }
                if (targetUserId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to view other users\' warnings.')], ephemeral: true });
                const userWarns = warns.get(targetUserId) || [];
                if (userWarns.length === 0) {
                    const embed = new EmbedBuilder().setDescription(`**${targetUserName}** has no warnings.`).setColor(0x00FF00).setTimestamp();
                    return interaction.reply({ embeds: [embed] });
                }
                let description = `**${userWarns.length} warning${userWarns.length !== 1 ? 's' : ''} found**\n\n`;
                const sortedWarns = [...userWarns].sort((a, b) => parseInt(b.id) - parseInt(a.id));
                sortedWarns.forEach((warn) => {
                    const date = new Date(parseInt(warn.id) * 1000).toLocaleDateString();
                    description += `**#${warn.id} | warn | ${date}**\n`;
                    description += `Responsible moderator: ${warn.moderator}\n`;
                    description += `Reason: ${warn.reason}\n\n`;
                });
                const embed = new EmbedBuilder().setDescription(description).setColor(0xFFA500).setTimestamp();
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'help': {
                const helpEmbed = new EmbedBuilder()
                    .setTitle('LawsHub | Help')
                    .setDescription(`Prefix : \`. \`\n\n<:2904notifystaff:1497275164818280480>︱AFK\n\`- afk <reason>\`\n\n<:3007link:1497275170631450777>︱Ticket System\n\`- ticket claim\`\n\`- ticket transfer <@user>\`\n\`- ticket close <reason>\`\n\n<:7428whitemember:1497274951521275995>︱Owner \n\`- say\`\n\`- stats\`\n\`- adminlist\`\n\n<:5448staffwhite:1497275091539726418>︱Role Management\n\`- promote\`\n\`- demote\`\n\`- wipe\`\n\`- unwipe\`\n\n<:7240partnerwhite:1497275068265271446>︱Nickname\n\`- fn\`\n\`- rfn\`\n\n<:7964modbadgewhite:1497275047528628314>︱Channel\n\`- lock\`\n\`- unlock\`\n\`- purge\`\n\n<:56832developer:1497274968507941026>︱Punishments\n\`- ban\`\n\`- unban\`\n\`- iunban\`\n\`- kick\`\n\`- mute\`\n\`- unmute\`\n\n<:6304whitesmalldot:1497275082836414675>︱Warning system\n\`- warn\`\n\`- unwarn\`\n\`- warns\`\n\`- cw\`\n\n<:unknown:1501163196021604362>︱Giveaway\n\`- gw create <duration> <winners> <prize>\`\n\`- gw reroll <message_id>\`\n\`- gw end <message_id>\`\n\`- gw list\`\n\n<:unknown:1501163685299884153>︱Purge\n\`- purge <amount>\` - Delete messages\n\`- purgeuser @user <amount>\` - Delete user's messages`)
                    .setColor(0x2A017F);
                await interaction.reply({ embeds: [helpEmbed] });
                break;
            }

            default:
                await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isButton() && !interaction.isUserSelectMenu()) return;
    
    // Handle giveaway buttons
    if (interaction.customId.startsWith('giveaway_')) {
        const giveawayId = interaction.customId.replace('giveaway_', '');
        const giveaway = activeGiveaways.get(giveawayId);
        if (!giveaway) return interaction.reply({ content: '❌ This giveaway has ended or does not exist.', ephemeral: true });
        if (giveaway.ended) return interaction.reply({ content: '❌ This giveaway has already ended.', ephemeral: true });
        if (giveaway.endTime <= Date.now()) {
            giveaway.ended = true;
            const channel = await interaction.guild.channels.fetch(giveaway.channelId);
            await endGiveaway(giveawayId, channel, giveaway.messageId, giveaway.prize, giveaway.winnerCount, giveaway.hostId, giveaway.participants, giveaway.guildName, giveaway.endTime, false);
            saveGiveaways();
            return interaction.reply({ content: '❌ This giveaway has ended.', ephemeral: true });
        }
        if (giveaway.participants.has(interaction.user.id)) return interaction.reply({ content: '❌ You have already entered this giveaway!', ephemeral: true });
        giveaway.participants.add(interaction.user.id);
        saveGiveaways();
        const channel = await interaction.guild.channels.fetch(giveaway.channelId);
        await updateGiveawayEmbed(giveawayId, channel, giveaway.messageId, giveaway.prize, giveaway.winnerCount, giveaway.hostId, giveaway.participants, giveaway.endTime);
        return interaction.reply({ content: '🎉 You have entered the giveaway! Good luck!', ephemeral: true });
    }
    
    // Handle ticket buttons
    if (interaction.customId.startsWith('ticket_')) {
        const ticketType = interaction.customId.replace('ticket_', '');
        if (ticketType === 'claim' || ticketType === 'close' || ticketType === 'transfer' || ticketType.startsWith('transcript_')) {
            // Handle action buttons
        } else {
            await createTicketChannel(interaction, ticketType);
            return interaction.deferUpdate().catch(() => {});
        }
    }
    
    // Handle ticket claim button
    if (interaction.customId === 'ticket_claim') {
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ This button can only be used in a ticket channel.', ephemeral: true });
        const supportRoleId = '1495189880760828075';
        if (!interaction.member.roles.cache.has(supportRoleId)) return interaction.reply({ content: '❌ You need the Support role to claim tickets.', ephemeral: true });
        if (claimedTickets.has(interaction.channel.id)) {
            const claimer = await interaction.guild.members.fetch(claimedTickets.get(interaction.channel.id)).catch(() => null);
            return interaction.reply({ content: `❌ This ticket is already claimed by ${claimer?.user.toString() || 'someone'}.`, ephemeral: true });
        }
        const userId = interaction.channel.name.replace('ticket-', '');
        const ticketOwner = await interaction.guild.members.fetch(userId).catch(() => null);
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
        await interaction.channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: false });
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        if (ticketOwner) await interaction.channel.permissionOverwrites.edit(ticketOwner.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        claimedTickets.set(interaction.channel.id, interaction.user.id);
        incrementTicketClaimCount(interaction.user.id);
        const embed = new EmbedBuilder().setTitle('Ticket Claimed').setDescription(`<a:unknown:1495084306781962432> **Ticket claimed by ${interaction.user.toString()}**\n\nThis ticket is now private.`).setColor(0x00FF00);
        await interaction.reply({ embeds: [embed] });
        // Update the embed to show claimed
        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        const ticketMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title === 'LawsHub Ticket Support');
        if (ticketMsg) {
            const updatedEmbed = EmbedBuilder.from(ticketMsg.embeds[0]);
            updatedEmbed.setDescription(updatedEmbed.data.description.replace('**Claimed by:** Not yet claimed', `**Claimed by:** ${interaction.user.toString()}`));
            await ticketMsg.edit({ embeds: [updatedEmbed] });
        }
    }

    // Handle ticket transfer button
    if (interaction.customId === 'ticket_transfer') {
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ This button can only be used in a ticket channel.', ephemeral: true });
        const supportRoleId = '1495189880760828075';
        if (!interaction.member.roles.cache.has(supportRoleId)) return interaction.reply({ content: '❌ You need the Support role to transfer tickets.', ephemeral: true });
        const userSelect = new UserSelectMenuBuilder()
            .setCustomId(`ticket_transfer_select_${interaction.channel.id}`)
            .setPlaceholder('Select a support member to transfer the ticket to')
            .setMinValues(1)
            .setMaxValues(1);
        const row = new ActionRowBuilder().addComponents(userSelect);
        await interaction.reply({ content: 'Please select a user to transfer this ticket to:', components: [row], ephemeral: true });
    }
    
    // Handle ticket close button
    if (interaction.customId === 'ticket_close') {
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ This button can only be used in a ticket channel.', ephemeral: true });
        const reason = 'Closed via button';
        const ticketOwnerId = interaction.channel.name.replace('ticket-', '');
        const ticketOwnerMember = await interaction.guild.members.fetch(ticketOwnerId).catch(() => null);
        const claimedById = claimedTickets.get(interaction.channel.id);
        const claimedByMember = claimedById ? await interaction.guild.members.fetch(claimedById).catch(() => null) : null;
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
        const logChannelId = '1497258421953499146';
        const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const closedAt = Math.floor(Date.now() / 1000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket_transcript_${interaction.channel.id}`)
                    .setLabel('View Transcript')
                    .setStyle(ButtonStyle.Primary)
            );
            const logEmbed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setDescription(`Closed by ${interaction.user.toString()}`)
                .addFields(
                    { name: 'Closed by', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'User', value: ticketOwnerMember ? ticketOwnerMember.user.tag : ticketOwnerId, inline: true },
                    { name: 'Claimed by', value: claimedByMember ? claimedByMember.user.tag : 'Not claimed', inline: true },
                    { name: 'Channel', value: interaction.channel.name, inline: true },
                    { name: 'Time', value: `<t:${closedAt}:R>`, inline: true }
                )
                .setColor(0xFF0000)
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed], components: [row] });
            if (transcript.length > 0) {
                storeTicketTranscript(interaction.channel.id, { transcript, channelName: interaction.channel.name });
            }
        }
        if (ticketOwnerMember) {
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Closed')
                    .setDescription(`Your ticket in **${interaction.guild.name}** has been closed.`)
                    .addFields(
                        { name: 'Closed by', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Channel', value: interaction.channel.name, inline: true }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();
                await ticketOwnerMember.send({ embeds: [dmEmbed] });
            } catch (err) {}
        }
        const embed = new EmbedBuilder()
            .setTitle('Ticket Closed')
            .setDescription(`<a:unknown:1495084306781962432> Ticket closed by ${interaction.user.toString()}\n**Reason:** ${reason}\n\nThis channel will be deleted in 5 seconds.`)
            .setColor(0xFF0000);
        await interaction.reply({ embeds: [embed] });
        setTimeout(async () => { try { await interaction.channel.delete(`Closed by ${interaction.user.tag}: ${reason}`); } catch (err) {} }, 5000);
        ticketData.delete(interaction.channel.id);
        claimedTickets.delete(interaction.channel.id);
    }

    // Handle ticket transfer selection
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('ticket_transfer_select_')) {
        const targetChannelId = interaction.customId.replace('ticket_transfer_select_', '');
        if (interaction.channel.id !== targetChannelId) return interaction.reply({ content: '❌ This transfer selection is no longer valid for this channel.', ephemeral: true });
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ This can only be used in a ticket channel.', ephemeral: true });
        const supportRoleId = '1495189880760828075';
        if (!interaction.member.roles.cache.has(supportRoleId)) return interaction.reply({ content: '❌ You need the Support role to transfer tickets.', ephemeral: true });
        const targetUserId = interaction.values[0];
        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetMember) return interaction.reply({ content: '❌ Could not find that user.', ephemeral: true });
        const currentClaimerId = claimedTickets.get(interaction.channel.id);
        if (currentClaimerId && currentClaimerId !== targetMember.id) {
            await interaction.channel.permissionOverwrites.delete(currentClaimerId).catch(() => {});
        }
        await interaction.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        claimedTickets.set(interaction.channel.id, targetMember.id);
        const replyEmbed = new EmbedBuilder().setTitle('Ticket Transferred').setDescription(`<a:unknown:1495084306781962432> **Ticket transferred to ${targetMember.toString()}**

Transferred by: ${interaction.user.toString()}`).setColor(0xFFA500);
        await interaction.update({ content: '✅ Ticket transferred successfully.', embeds: [replyEmbed], components: [] });
        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        const ticketMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title === 'LawsHub Ticket Support');
        if (ticketMsg) {
            const updatedEmbed = EmbedBuilder.from(ticketMsg.embeds[0]);
            updatedEmbed.setDescription(updatedEmbed.data.description.replace(/\*\*Claimed by:\*\*.*$/m, `**Claimed by:** ${targetMember.toString()}`));
            await ticketMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_transcript_')) {
        const channelId = interaction.customId.replace('ticket_transcript_', '');
        const transcriptData = ticketTranscripts.get(channelId);
        if (!transcriptData) return interaction.reply({ content: '❌ Transcript is not available or has expired.', ephemeral: true });
        const transcriptBuffer = Buffer.from(transcriptData.transcript, 'utf-8');
        await interaction.reply({ content: `📄 Transcript for ${transcriptData.channelName}`, files: [{ attachment: transcriptBuffer, name: `transcript-${transcriptData.channelName}.txt` }], ephemeral: true });
        return;
    }
    
    // Handle confirmation buttons
    if (interaction.customId.startsWith('confirm_ban_') || interaction.customId.startsWith('confirm_kick_') || interaction.customId.startsWith('confirm_jail_') || interaction.customId.startsWith('confirm_unban_') || interaction.customId.startsWith('confirm_iunban_')) {
        const [, action, ...idParts] = interaction.customId.split('_');
        const confirmationId = idParts.join('_');
        const pendingData = pendingActions.get(confirmationId);
        if (!pendingData) return interaction.reply({ content: '❌ This confirmation request has expired or is invalid.', ephemeral: true });
        if (interaction.user.id !== pendingData.originalCommandAuthorId) return interaction.reply({ content: '❌ Only the moderator who issued the command can confirm this action.', ephemeral: true });
        const guild = interaction.guild;
        const reason = pendingData.reason;
        try {
            let successEmbed;
            switch (action) {
                case 'iunban':
                    const iunbanBans = await guild.bans.fetch();
                    const iunbanEntry = iunbanBans.get(pendingData.targetUserId);
                    if (!iunbanEntry) return interaction.reply({ content: '❌ Could not find that user in the ban list.', ephemeral: true });
                    await guild.bans.remove(pendingData.targetUserId, `Unbanned by ${interaction.user.tag}`);
                    let dmSent = false;
                    try {
                        const dmEmbed = new EmbedBuilder().setTitle('You have been unbanned!').setDescription(`You have been unbanned from **${guild.name}**.\n\nClick here to join back: https://discord.com/invite/Ur3gxVQSQH`).setColor(0x00FF00).setTimestamp();
                        await iunbanEntry.user.send({ embeds: [dmEmbed] });
                        dmSent = true;
                    } catch (dmError) {}
                    successEmbed = createSuccessEmbed('User Unbanned + DM', `**User:** ${iunbanEntry.user.toString()}\n**User ID:** ${pendingData.targetUserId}\n\n**Moderator:** ${interaction.user.toString()}\n\n**DM Status:** ${dmSent ? '✅ Invite link sent' : '❌ Could not DM user'}`);
                    break;
                case 'ban':
                    const targetMember = await guild.members.fetch(pendingData.targetUserId).catch(() => null);
                    if (!targetMember) return interaction.reply({ content: '❌ The target user is no longer in the server.', ephemeral: true });
                    await targetMember.ban({ reason: `Banned by ${interaction.user.tag}: ${reason}` });
                    successEmbed = createSuccessEmbed('User Banned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${interaction.user.toString()}\n\n**Reason:** ${reason}`);
                    break;
                case 'kick':
                    const kickMember = await guild.members.fetch(pendingData.targetUserId).catch(() => null);
                    if (!kickMember) return interaction.reply({ content: '❌ The target user is no longer in the server.', ephemeral: true });
                    await kickMember.kick(`Kicked by ${interaction.user.tag}: ${reason}`);
                    successEmbed = createSuccessEmbed('User Kicked', `**User:** ${kickMember.user.toString()}\n\n**Moderator:** ${interaction.user.toString()}\n\n**Reason:** ${reason}`);
                    break;
                case 'jail':
                    const jailMember = await guild.members.fetch(pendingData.targetUserId).catch(() => null);
                    if (!jailMember) return interaction.reply({ content: '❌ The target user is no longer in the server.', ephemeral: true });
                    const jailRoleId = '1495194861530513440';
                    const jailRole = guild.roles.cache.get(jailRoleId);
                    if (!jailRole) return interaction.reply({ content: '❌ Jail role not found.', ephemeral: true });
                    const rolesToBackup = jailMember.roles.cache.filter(role => role.name !== '@everyone' && role.id !== jailRole.id);
                    const roleIds = rolesToBackup.map(role => role.id);
                    jailBackups.set(jailMember.id, roleIds);
                    await jailMember.roles.set([jailRole], `Jailed by ${interaction.user.tag}: ${reason}`);
                    successEmbed = createSuccessEmbed('User Jailed', `**User:** ${jailMember.user.toString()}\n\n**Moderator:** ${interaction.user.toString()}\n\n**Reason:** ${reason}`);
                    break;
                case 'unban':
                    const bans = await guild.bans.fetch();
                    const banEntry = bans.get(pendingData.targetUserId);
                    if (!banEntry) return interaction.reply({ content: '❌ Could not find that user in the ban list.', ephemeral: true });
                    await guild.bans.remove(pendingData.targetUserId, `Unbanned by ${interaction.user.tag}`);
                    successEmbed = createSuccessEmbed('User Unbanned', `**User:** ${banEntry.user.toString()}\n**User ID:** ${pendingData.targetUserId}\n\n**Moderator:** ${interaction.user.toString()}`);
                    break;
                default: return interaction.reply({ content: 'Unknown action.', ephemeral: true });
            }
            await interaction.update({ embeds: [successEmbed], components: [] });
            // Delete the original command message after 5 seconds
            if (pendingData.originalCommandId) {
                const originalChannel = await interaction.guild.channels.fetch(pendingData.channelId).catch(() => null);
                if (originalChannel) {
                    try {
                        const originalMsg = await originalChannel.messages.fetch(pendingData.originalCommandId).catch(() => null);
                        if (originalMsg) setTimeout(() => originalMsg.delete().catch(() => {}), 5000);
                    } catch (err) {}
                }
            }
            pendingActions.delete(confirmationId);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `❌ Failed to ${action} user.`, ephemeral: true });
        }
    }
    
    // Handle cancel button
    if (interaction.customId.startsWith('confirm_cancel_')) {
        const [, , ...idParts] = interaction.customId.split('_');
        const confirmationId = idParts.join('_');
        const pendingData = pendingActions.get(confirmationId);
        if (pendingData && interaction.user.id === pendingData.originalCommandAuthorId) {
            // Delete the original command message after 5 seconds
            const originalChannel = await interaction.guild.channels.fetch(pendingData.channelId).catch(() => null);
            if (originalChannel) {
                try {
                    const originalMsg = await originalChannel.messages.fetch(pendingData.originalCommandId).catch(() => null);
                    if (originalMsg) setTimeout(() => originalMsg.delete().catch(() => {}), 5000);
                } catch (err) {}
            }
            await interaction.update({ content: '❌ Action cancelled. This message will be deleted in 5 seconds.', embeds: [], components: [] });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            pendingActions.delete(confirmationId);
        } else {
            await interaction.reply({ content: '❌ This confirmation is not for you or has expired.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
    }
});

const token = process.env.DISCORD_TOKEN
client.login(token);

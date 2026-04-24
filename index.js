const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
const roleBackups = new Map(); // For wipe/unwipe
const jailBackups = new Map(); // For jail/unjail
const forcedNicknames = new Map();
const channelPermBackups = new Map(); // Store original channel permissions for lock/unlock
const afkUsers = new Map(); // AFK System - Store AFK users
const claimedTickets = new Map(); // Ticket System - Store claimed tickets

// Ticket categories
const ticketCategories = {
    'script-key': { name: 'Script/Key Support', emoji: '1497257556295422132' }
};

// Persistent warnings storage
const WARNINGS_FILE = './warnings.json';
let warns = new Map();

// Auto-warn action configuration
const warnActions = {
    5: { action: 'demote', deleteWarns: true },
};

// Load warnings from file
function loadWarnings() {
    if (fs.existsSync(WARNINGS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
            warns = new Map(Object.entries(data));
            console.log(`✅ Loaded ${warns.size} user warnings from file`);
        } catch (e) {
            console.log('No valid warnings file found, starting fresh');
        }
    }
}

function saveWarnings() {
    const obj = Object.fromEntries(warns);
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(obj, null, 2));
    console.log(`💾 Saved warnings to file`);
}

loadWarnings();

// Function to create a ticket channel
async function createTicketChannel(interaction, ticketType) {
    const guild = interaction.guild;
    const user = interaction.user;
    const categoryId = '1497258380325027960';
    const supportRoleId = '1495189880760828075';
    
    const existingChannel = guild.channels.cache.find(
        channel => channel.name === `ticket-${user.id}` && channel.parentId === categoryId
    );
    
    if (existingChannel) {
        return interaction.reply({ 
            content: '❌ You already have an open ticket! Please close it first.', 
            ephemeral: true 
        });
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
        
        await channel.send({ 
            content: `${user.toString()} <@&${supportRoleId}>`,
            embeds: [ticketEmbed] 
        });
        
        await interaction.reply({ 
            content: `<a:unknown:1495084306781962432> Ticket created! Please continue in ${channel.toString()}`, 
            ephemeral: true 
        });
        
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Failed to create ticket channel.', ephemeral: true });
    }
}

// Function to process warn actions
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
            } catch (dmError) {
                console.log(`Could not DM ${targetMember.user.tag}`);
            }
        }

        return actionPerformed;
    } catch (error) {
        console.error(`Auto-action failed for ${userId}:`, error);
        return false;
    }
}

const startTime = Date.now();

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

// Monitor nickname changes for forcenick
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
        } catch (error) {
            console.error(`Failed to restore nickname for ${newMember.user.tag}:`, error);
        }
    }
});

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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ========== AFK SYSTEM - PING HANDLING (runs for EVERY message) ==========
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

                if (afkData.storedMessages.length > 10) {
                    afkData.storedMessages.shift();
                }

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

    // When AFK user sends a message, show them their stored messages
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
        } catch (err) {
            console.log('Could not remove AFK nickname');
        }

        const backEmbed = new EmbedBuilder()
            .setDescription(`<a:unknown:1495084306781962432> **${message.author.username}** is no longer AFK\n**Duration:** ${durationText}`)
            .setColor(0x00FF00)
            .setTimestamp();

        await message.reply({ embeds: [backEmbed] });

        if (afkData.storedMessages.length > 0) {
            const storedMessages = afkData.storedMessages;
            const messagesText = storedMessages.map((msg, i) => {
                return `**${i + 1}.** ${msg.author} in #${msg.channelName}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`;
            }).join('\n\n');

            const storedEmbed = new EmbedBuilder()
                .setTitle('📬 Messages While You Were AFK')
                .setDescription(`You received **${storedMessages.length}** message${storedMessages.length !== 1 ? 's' : ''} while AFK:\n\n${messagesText}`)
                .setColor(0x00AAFF)
                .setTimestamp();

            await message.reply({ embeds: [storedEmbed] });
        }
    }

    // Check for command messages
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ========== AFK SET COMMAND ==========
    if (command === 'afk') {
        const reason = args.join(' ') || 'No reason provided';
        const userId = message.author.id;

        afkUsers.set(userId, {
            reason: reason,
            timestamp: Date.now(),
            storedMessages: []
        });

        try {
            const currentNick = message.member.nickname || message.author.username;
            if (!currentNick.startsWith('[AFK]')) {
                await message.member.setNickname(`[AFK] ${currentNick.substring(0, 28)}`, 'AFK mode enabled');
            }
        } catch (err) {
            console.log('Could not set AFK nickname (missing permissions)');
        }

        const afkEmbed = new EmbedBuilder()
            .setDescription(`<a:unknown:1495084306781962432> **${message.author.username}** is now AFK\n**Reason:** ${reason}`)
            .setColor(0x00FF00)
            .setTimestamp();

        await message.reply({ embeds: [afkEmbed] });
    }

    // ========== TICKET PANEL COMMAND ==========
    if (command === 'ticketpanel') {
        const targetChannel = message.mentions.channels.first() || message.channel;
        
        const panelEmbed = new EmbedBuilder()
            .setTitle('LawsHub Support')
            .setDescription('**Please select a button below to open a ticket.**')
            .setColor(0x2B017F);
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_script-key')
                    .setLabel('Script/Key')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('1497257556295422132')
            );
        
        await targetChannel.send({ embeds: [panelEmbed], components: [row] });
        await message.reply(`✅ Ticket panel sent to ${targetChannel.toString()}`);
    }

    // ========== TICKET COMMANDS ==========
    if (command === 'ticket') {
        const subCommand = args[0]?.toLowerCase();
        
        if (!message.channel.name.startsWith('ticket-')) {
            return message.reply('❌ This command can only be used in a ticket channel.');
        }
        
        const userId = message.channel.name.replace('ticket-', '');
        const ticketOwner = await message.guild.members.fetch(userId).catch(() => null);
        const supportRoleId = '1495189880760828075';
        
        // CLAIM
        if (subCommand === 'claim') {
            if (!message.member.roles.cache.has(supportRoleId)) {
                return message.reply('❌ You need the Support role to claim tickets.');
            }
            
            if (claimedTickets.has(message.channel.id)) {
                const claimer = await message.guild.members.fetch(claimedTickets.get(message.channel.id)).catch(() => null);
                return message.reply(`❌ This ticket is already claimed by ${claimer?.user.toString() || 'someone'}.`);
            }
            
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: false });
            await message.channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: false });
            await message.channel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            
            if (ticketOwner) {
                await message.channel.permissionOverwrites.edit(ticketOwner.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            }
            
            claimedTickets.set(message.channel.id, message.author.id);
            
            const embed = new EmbedBuilder()
                .setTitle('Ticket Claimed')
                .setDescription(`<a:unknown:1495084306781962432> **Ticket claimed by ${message.author.toString()}**\n\nThis ticket is now private.`)
                .setColor(0x00FF00);
            
            await message.reply({ embeds: [embed] });
        }
        
        // TRANSFER
        else if (subCommand === 'transfer') {
            const targetInput = args[1];
            if (!targetInput) {
                return message.reply('❌ Please mention a user to transfer this ticket to. Example: `.ticket transfer @user`');
            }
            
            if (!message.member.roles.cache.has(supportRoleId)) {
                return message.reply('❌ You need the Support role to transfer tickets.');
            }
            
            const targetUserId = getUserIdFromInput(targetInput);
            if (!targetUserId) {
                return message.reply('❌ Invalid user.');
            }
            
            const targetMember = await message.guild.members.fetch(targetUserId).catch(() => null);
            if (!targetMember) {
                return message.reply('❌ Could not find that user.');
            }
            
            const currentClaimerId = claimedTickets.get(message.channel.id);
            
            if (currentClaimerId) {
                await message.channel.permissionOverwrites.delete(currentClaimerId);
            }
            
            await message.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            
            claimedTickets.set(message.channel.id, targetMember.id);
            
            const embed = new EmbedBuilder()
                .setTitle('Ticket Transferred')
                .setDescription(`<a:unknown:1495084306781962432> **Ticket transferred to ${targetMember.toString()}**\n\nTransferred by: ${message.author.toString()}`)
                .setColor(0xFFA500);
            
            await message.reply({ embeds: [embed] });
        }
        
        // CLOSE
        else if (subCommand === 'close') {
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
                
                await logChannel.send({ embeds: [logEmbed] });
                
                if (transcript.length > 0) {
                    const transcriptBuffer = Buffer.from(transcript, 'utf-8');
                    await logChannel.send({ 
                        content: `📝 **Transcript for ${message.channel.name}**`,
                        files: [{ attachment: transcriptBuffer, name: `transcript-${message.channel.name}.txt` }] 
                    }).catch(() => {});
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
                    
                    await ticketOwnerMember.send({ 
                        embeds: [dmEmbed],
                        files: [{ attachment: transcriptBuffer, name: `transcript-${message.channel.name}.txt` }]
                    });
                } catch (err) {
                    console.log('Could not DM ticket owner');
                }
            }
            
            const embed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setDescription(`<a:unknown:1495084306781962432> Ticket closed by ${message.author.toString()}\n**Reason:** ${reason}\n\nThis channel will be deleted in 5 seconds.`)
                .setColor(0xFF0000);
            
            await message.reply({ embeds: [embed] });
            
            setTimeout(async () => {
                try {
                    await message.channel.delete(`Closed by ${message.author.tag}: ${reason}`);
                } catch (err) {
                    console.log('Could not delete channel');
                }
            }, 5000);
        }
        else {
            return message.reply('Available ticket commands: `.ticket claim`, `.ticket transfer @user`, `.ticket close <reason>`');
        }
    }

    // ========== SAY COMMAND (Owner Only) ==========
    if (command === 'say') {
        const OWNER_ID = '1413103929931337751';

        if (message.author.id !== OWNER_ID) {
            return message.reply(`<:unknown:1495103708957118684> Only the bot owner can use this command.`);
        }

        const sayMessage = args.join(' ');
        if (!sayMessage) {
            return message.reply(`<:unknown:1495103708957118684> Please provide a message to say. Example: \`.say Hello world!\``);
        }

        try {
            await message.delete();
            await message.channel.send(sayMessage);
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to send message.`);
        }
    }

    // ========== ADMIN LIST COMMAND (.adminlist) ==========
    if (command === 'adminlist') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Administrator** permission to view the admin list.`);
        }

        try {
            const adminMembers = [];

            await message.guild.members.fetch();

            for (const [id, member] of message.guild.members.cache) {
                if (member.permissions.has(PermissionFlagsBits.Administrator)) {
                    adminMembers.push(member);
                }
            }

            if (adminMembers.length === 0) {
                return message.reply({ embeds: [createErrorEmbed('No Admins', 'No members with Administrator permission found.')] });
            }

            adminMembers.sort((a, b) => b.roles.highest.position - a.roles.highest.position);

            let description = `**Total Administrators:** ${adminMembers.length}\n\n`;

            adminMembers.forEach((member, index) => {
                const highestRole = member.roles.highest.name !== '@everyone' ? member.roles.highest.name : 'No role';
                description += `**${index + 1}.** ${member.user.toString()}\n`;
                description += `└ ID: \`${member.id}\` | Role: ${highestRole}\n\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('👑 Server Administrators')
                .setDescription(description)
                .setColor(0xFF0000)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to fetch admin list.`);
        }
    }

    // ========== STATS COMMAND ==========
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

    // ========== PROMOTE COMMAND ==========
    if (command === 'promote') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to promote. Example: `.promote @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('You need **Manage Roles** permission to promote someone.');
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('I need **Manage Roles** permission to promote someone.');
        }

        const PROTECTED_ROLE_ID = '1495209173086896158';

        let userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
        let currentRole = null;
        const nonProtectedRoles = userRoles.filter(role => role.id !== PROTECTED_ROLE_ID);

        if (nonProtectedRoles.size > 0) {
            currentRole = nonProtectedRoles.sort((a, b) => a.position - b.position).first();
        } else {
            currentRole = message.guild.roles.cache.get(PROTECTED_ROLE_ID);
            if (!currentRole) {
                return message.reply('Could not find the protected role.');
            }
        }

        const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
        const sortedRoles = allRoles.sort((a, b) => a.position - b.position);

        let roleToGive = null;
        let foundCurrent = false;
        for (const role of sortedRoles.values()) {
            if (foundCurrent) {
                roleToGive = role;
                break;
            }
            if (role.id === currentRole.id) foundCurrent = true;
        }

        if (!roleToGive) return message.reply(`${targetMember.user.tag} already has the lowest role!`);

        try {
            await targetMember.roles.add(roleToGive);
            if (currentRole.id !== PROTECTED_ROLE_ID) {
                await targetMember.roles.remove(currentRole);
            }

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Promotion')
                .setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${currentRole.name}\n\n**Current role:** ${roleToGive.name}\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}`)
                .setColor(0x00FF00);

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply('Failed to promote user.');
        }
    }

    // ========== DEMOTE COMMAND ==========
    if (command === 'demote') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to demote. Example: `.demote @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('You need **Manage Roles** permission to demote someone.');
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('I need **Manage Roles** permission to demote someone.');
        }

        const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
        if (userRoles.size === 0) {
            return message.reply(`${targetMember.user.tag} has no roles to demote from.`);
        }

        const lowestUserRole = userRoles.sort((a, b) => a.position - b.position).first();
        
        const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
        const sortedRoles = allRoles.sort((a, b) => a.position - b.position);
        
        let roleToGive = null;
        let foundCurrent = false;
        for (const role of sortedRoles.values()) {
            if (foundCurrent) {
                roleToGive = role;
                break;
            }
            if (role.id === lowestUserRole.id) foundCurrent = true;
        }

        if (!roleToGive) return message.reply(`${targetMember.user.tag} already has the lowest role!`);

        try {
            await targetMember.roles.add(roleToGive);
            await targetMember.roles.remove(lowestUserRole);

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Demotion')
                .setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Previous role:** ${lowestUserRole.name}\n\n**Current role:** ${roleToGive.name}\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}`)
                .setColor(0xFF0000);

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply('Failed to demote user.');
        }
    }

    // ========== FORCENICK COMMAND (.fn) ==========
    if (command === 'fn') {
        const userInput = args[0];
        const newNickname = args.slice(1).join(' ');

        if (!userInput || !newNickname) {
            return message.reply(`<:unknown:1495103708957118684> Please provide a user and nickname. Example: \`.fn @user DesiredNickname\``);
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply(`<:unknown:1495103708957118684> Invalid user ID.`);
        }

        if (userId === message.author.id) {
            return message.reply(`<:unknown:1495103708957118684> You cannot force your own nickname.`);
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply(`<:unknown:1495103708957118684> Could not find that user in the server.`);
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Manage Nicknames** permission to force a nickname.`);
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            return message.reply(`<:unknown:1495103708957118684> I need **Manage Nicknames** permission to set nicknames.`);
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;

        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply(`<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`);
        }

        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) {
            return message.reply(`<:unknown:1495103708957118684> Cannot force nickname for ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`);
        }

        if (newNickname.length > 32) {
            return message.reply(`<:unknown:1495103708957118684> Nickname must be 32 characters or less.`);
        }

        try {
            await targetMember.setNickname(newNickname, `Forced by ${message.author.tag}`);
            forcedNicknames.set(targetMember.id, { nickname: newNickname, moderator: message.author.tag });

            await message.reply(`<a:unknown:1495084306781962432> Forced nicknamed ${targetMember.user.toString()} to **${newNickname}**`);
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to force nickname.`);
        }
    }

    // ========== REMOVE FORCENICK COMMAND (.rfn) ==========
    if (command === 'rfn') {
        const userInput = args[0];

        if (!userInput) {
            return message.reply(`<:unknown:1495103708957118684> Please provide a user. Example: \`.rfn @user\``);
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply(`<:unknown:1495103708957118684> Invalid user ID.`);
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Manage Nicknames** permission to remove forced nicknames.`);
        }

        if (!forcedNicknames.has(userId)) {
            return message.reply(`<:unknown:1495103708957118684> This user does not have a forced nickname.`);
        }

        const forcedData = forcedNicknames.get(userId);
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        try {
            forcedNicknames.delete(userId);

            if (targetMember) {
                try {
                    await targetMember.setNickname(null, `Forced nickname removed by ${message.author.tag}`);
                } catch (nickError) {}
            }

            await message.reply(`<a:unknown:1495084306781962432> Removed forced nickname from ${targetMember ? targetMember.user.toString() : `user ${userId}`} (was **${forcedData.nickname}**)`);
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to remove forced nickname.`);
        }
    }

    // ========== CLEAR WARNS COMMAND (.cw) ==========
    if (command === 'cw') {
        const userInput = args[0];

        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user to clear warnings. Example: `.cw @user` or `.cw 123456789012345678`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot clear your own warnings.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Administrator** permission to clear warnings.')] });
        }

        if (!warns.has(userId)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'This user has no warnings to clear.')] });
        }

        const warnCount = warns.get(userId).length;
        warns.delete(userId);
        saveWarnings();

        const embed = createSuccessEmbed('Warnings Cleared', `**User:** <@${userId}>\n**Warnings Removed:** ${warnCount}\n\n**Cleared by:** ${message.author.toString()}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== WIPE COMMAND ==========
    if (command === 'wipe') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user. Example: `.wipe @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('You need **Manage Roles** permission.');
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('I need **Manage Roles** permission.');
        }

        const highestTargetRole = targetMember.roles.highest;
        const highestBotRole = botMember.roles.highest;

        if (highestTargetRole.position >= highestBotRole.position && highestTargetRole.name !== '@everyone') {
            return message.reply(`Cannot wipe ${targetMember.user.tag} - they have a role higher than my highest role.`);
        }

        try {
            const rolesToBackup = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            const roleIds = rolesToBackup.map(role => role.id);
            const roleNames = rolesToBackup.map(role => role.name).join(', ') || 'None';
            roleBackups.set(targetMember.id, roleIds);

            await targetMember.roles.set([], `Wiped by ${message.author.tag} (${message.author.id})`);

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Wipe')
                .setDescription(`**User Wiped** ${targetMember.user.toString()}\n\n**Roles Removed:** ${rolesToBackup.size}\n**Removed Roles:** ${roleNames}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`)
                .setColor(0xFFA500);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply('Failed to wipe roles.');
        }
    }

    // ========== UNWIPE COMMAND ==========
    if (command === 'unwipe') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user. Example: `.unwipe @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('You need **Manage Roles** permission.');
        }

        const backupRoleIds = roleBackups.get(targetMember.id);
        if (!backupRoleIds || backupRoleIds.length === 0) {
            return message.reply(`No wiped roles found for ${targetMember.user.tag}. The bot may have restarted since the wipe.`);
        }

        try {
            const rolesToRestore = [];
            const roleNames = [];
            for (const roleId of backupRoleIds) {
                const role = message.guild.roles.cache.get(roleId);
                if (role) {
                    rolesToRestore.push(role);
                    roleNames.push(role.name);
                }
            }

            if (rolesToRestore.length === 0) {
                return message.reply('Cannot restore - the original roles no longer exist.');
            }

            await targetMember.roles.add(rolesToRestore, `Restored by ${message.author.tag} (${message.author.id})`);
            roleBackups.delete(targetMember.id);

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Unwipe')
                .setDescription(`**User Unwiped** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.join(', ')}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`)
                .setColor(0x00FF00);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply('Failed to restore roles.');
        }
    }

    // ========== JAIL COMMAND ==========
    if (command === 'jail') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to jail. Example: `.jail @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply('You need **Moderate Members** permission to jail someone.');
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('I need **Manage Roles** permission to assign the jail role.');
        }

        const jailRoleId = '1495194861530513440';
        const jailRole = message.guild.roles.cache.get(jailRoleId);

        if (!jailRole) {
            return message.reply(`Could not find the jail role. Please make sure the role ID is correct.`);
        }

        const highestBotRole = botMember.roles.highest;
        if (jailRole.position >= highestBotRole.position) {
            return message.reply(`The jail role is higher than or equal to my highest role. Please move my role above the jail role.`);
        }

        if (targetMember.roles.cache.has(jailRole.id)) {
            return message.reply(`${targetMember.user.tag} is already jailed!`);
        }

        try {
            const rolesToBackup = targetMember.roles.cache.filter(role => role.name !== '@everyone' && role.id !== jailRole.id);
            const roleIds = rolesToBackup.map(role => role.id);
            const roleNames = rolesToBackup.map(role => role.name).join(', ') || 'None';
            jailBackups.set(targetMember.id, roleIds);

            await targetMember.roles.set([jailRole], `Jailed by ${message.author.tag} (${message.author.id})`);

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Jail')
                .setDescription(`**User Jailed** ${targetMember.user.toString()}\n\n**Roles Removed:** ${rolesToBackup.size}\n**Removed Roles:** ${roleNames}\n**Jail Role:** ${jailRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`)
                .setColor(0xFFA500);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply('Failed to jail user.');
        }
    }

    // ========== UNJAIL COMMAND ==========
    if (command === 'unjail') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to unjail. Example: `.unjail @user`');
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply('Could not find user.');
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply('You need **Moderate Members** permission to unjail someone.');
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('I need **Manage Roles** permission to remove the jail role.');
        }

        const jailRoleId = '1495194861530513440';
        const jailRole = message.guild.roles.cache.get(jailRoleId);

        if (!jailRole) {
            return message.reply(`Could not find the jail role. Please make sure the role ID is correct.`);
        }

        if (!targetMember.roles.cache.has(jailRole.id)) {
            return message.reply(`${targetMember.user.tag} is not jailed.`);
        }

        try {
            const backupRoleIds = jailBackups.get(targetMember.id);
            const rolesToRestore = [];
            const roleNames = [];

            if (backupRoleIds && backupRoleIds.length > 0) {
                for (const roleId of backupRoleIds) {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role) {
                        rolesToRestore.push(role);
                        roleNames.push(role.name);
                    }
                }
            }

            await targetMember.roles.set(rolesToRestore, `Unjailed by ${message.author.tag} (${message.author.id})`);
            jailBackups.delete(targetMember.id);

            const embed = new EmbedBuilder()
                .setTitle('LawsHub Unjail')
                .setDescription(`**User Unjailed** ${targetMember.user.toString()}\n\n**Roles Restored:** ${rolesToRestore.length}\n**Restored Roles:** ${roleNames.length > 0 ? roleNames.join(', ') : 'None'}\n**Jail Role Removed:** ${jailRole.name}\n\n**Time:** ${new Date().toLocaleString()}\n**Moderator:** ${message.author.toString()}`)
                .setColor(0x00FF00);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply('Failed to unjail user.');
        }
    }

    // ========== LOCK COMMAND ==========
    if (command === 'lock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Manage Channels** permission to lock channels.`);
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(`<:unknown:1495103708957118684> I need **Manage Channels** permission to lock channels.`);
        }

        let targetChannel = message.mentions.channels.first() || message.channel;
        let reason = getReason(args.slice(targetChannel === message.channel ? 0 : 1), 'No reason provided');

        try {
            if (!channelPermBackups.has(targetChannel.id)) {
                const originalPerms = {};
                const everyoneRole = message.guild.roles.everyone;

                const everyonePerms = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);
                if (everyonePerms) {
                    originalPerms[everyoneRole.id] = {
                        allow: everyonePerms.allow.bitfield.toString(),
                        deny: everyonePerms.deny.bitfield.toString()
                    };
                } else {
                    originalPerms[everyoneRole.id] = { allow: '0', deny: '0' };
                }

                for (const [roleId, overwrite] of targetChannel.permissionOverwrites.cache) {
                    if (roleId !== everyoneRole.id) {
                        originalPerms[roleId] = {
                            allow: overwrite.allow.bitfield.toString(),
                            deny: overwrite.deny.bitfield.toString()
                        };
                    }
                }

                channelPermBackups.set(targetChannel.id, originalPerms);
            }

            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                SendMessagesInThreads: false
            });

            const embed = new EmbedBuilder()
                .setTitle('🔒 Channel Locked')
                .setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${message.author.toString()}\n**Reason:** ${reason}\n\nUse \`.unlock\` to restore original permissions.`)
                .setColor(0xFFA500)
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to lock channel.`);
        }
    }

    // ========== UNLOCK COMMAND ==========
    if (command === 'unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(`<:unknown:1495103708957118684> You need **Manage Channels** permission to unlock channels.`);
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(`<:unknown:1495103708957118684> I need **Manage Channels** permission to unlock channels.`);
        }

        let targetChannel = message.mentions.channels.first() || message.channel;
        let reason = getReason(args.slice(targetChannel === message.channel ? 0 : 1), 'No reason provided');

        try {
            const originalPerms = channelPermBackups.get(targetChannel.id);

            if (originalPerms) {
                const everyoneRole = message.guild.roles.everyone;
                const everyonePerms = originalPerms[everyoneRole.id];

                if (everyonePerms) {
                    await targetChannel.permissionOverwrites.edit(everyoneRole, {
                        SendMessages: everyonePerms.allow.includes('SendMessages') ? true : null,
                        AddReactions: everyonePerms.allow.includes('AddReactions') ? true : null,
                        CreatePublicThreads: everyonePerms.allow.includes('CreatePublicThreads') ? true : null,
                        CreatePrivateThreads: everyonePerms.allow.includes('CreatePrivateThreads') ? true : null,
                        SendMessagesInThreads: everyonePerms.allow.includes('SendMessagesInThreads') ? true : null
                    });
                } else {
                    await targetChannel.permissionOverwrites.edit(everyoneRole, {
                        SendMessages: null,
                        AddReactions: null,
                        CreatePublicThreads: null,
                        CreatePrivateThreads: null,
                        SendMessagesInThreads: null
                    });
                }

                channelPermBackups.delete(targetChannel.id);
            } else {
                await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    SendMessages: null,
                    AddReactions: null,
                    CreatePublicThreads: null,
                    CreatePrivateThreads: null,
                    SendMessagesInThreads: null
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🔓 Channel Unlocked')
                .setDescription(`**Channel:** ${targetChannel.toString()}\n**Moderator:** ${message.author.toString()}\n**Reason:** ${reason}\n\nOriginal permissions have been restored.`)
                .setColor(0x00FF00)
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply(`<:unknown:1495103708957118684> Failed to unlock channel.`);
        }
    }

    // ========== PURGE COMMAND ==========
    if (command === 'purge') {
        const amount = parseInt(args[0]);

        if (!amount || isNaN(amount)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number of messages to delete. Example: `.purge 10`')] });
        }

        if (amount < 1 || amount > 100) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a number between 1 and 100.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Manage Messages** permission to purge messages.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Manage Messages** permission to purge messages.')] });
        }

        try {
            const fetched = await message.channel.messages.fetch({ limit: amount });
            const deleted = await message.channel.bulkDelete(fetched, true);

            const embed = createSuccessEmbed('Messages Purged', `**Deleted:** ${deleted.size} messages\n**Channel:** ${message.channel.toString()}\n**Moderator:** ${message.author.toString()}`);
            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge messages. Messages may be older than 14 days.')] });
        }
    }

    // ========== BAN COMMAND ==========
    if (command === 'ban') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to ban. Example: `.ban 123456789012345678 reason here` or `.ban @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot ban yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to ban someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission to ban someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;

        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        }

        const reason = getReason(args.slice(1));

        try {
            await targetMember.ban({ reason: `Banned by ${message.author.tag}: ${reason}` });
            const embed = createSuccessEmbed('User Banned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to ban user.')] });
        }
    }

    // ========== UNBAN COMMAND ==========
    if (command === 'unban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.unban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);

            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            }

            const unbannedUser = banEntry.user;
            await message.guild.bans.remove(unbannedUser.id);

            const embed = createSuccessEmbed('User Unbanned', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', `Failed to unban user.`)] });
        }
    }

    // ========== IUNBAN COMMAND ==========
    if (command === 'iunban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.iunban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);

            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            }

            const unbannedUser = banEntry.user;
            await message.guild.bans.remove(unbannedUser.id);

            let dmSent = false;
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('You have been unbanned!')
                    .setDescription(`You have been unbanned from **${message.guild.name}**.\n\nClick here to join back: https://discord.com/invite/Ur3gxVQSQH`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await unbannedUser.send({ embeds: [dmEmbed] });
                dmSent = true;
            } catch (dmError) {
                console.log(`Could not DM ${unbannedUser.tag}`);
            }

            const embed = createSuccessEmbed('User Unbanned + DM', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}\n\n**DM Status:** ${dmSent ? '✅ Invite link sent' : '❌ Could not DM user'}`);
            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', `Failed to unban user.`)] });
        }
    }

    // ========== KICK COMMAND ==========
    if (command === 'kick') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to kick. Example: `.kick 123456789012345678 reason here` or `.kick @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot kick yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Kick Members** permission to kick someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Kick Members** permission to kick someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;

        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        }

        const reason = getReason(args.slice(1));

        try {
            await targetMember.kick(`Kicked by ${message.author.tag}: ${reason}`);
            const embed = createSuccessEmbed('User Kicked', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to kick user.')] });
        }
    }

    // ========== MUTE COMMAND ==========
    if (command === 'mute') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to mute. Example: `.mute @user 30s reason here` or `.mute @user 5m reason here`\n\n**Formats:** s (seconds), m (minutes), h (hours), d (days), w (weeks)')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot mute yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to mute someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to mute someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;

        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot mute ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        let duration = args[1];
        let reasonStart = 2;
        let milliseconds = 0;

        if (!duration || !duration.match(/^\d+[smhdw]$/)) {
            duration = '10m';
            reasonStart = 1;
        }

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
        if (milliseconds > maxMs) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Maximum mute duration is 28 days. Please use a shorter duration.')] });
        }

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
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to mute user.')] });
        }
    }

    // ========== UNMUTE COMMAND ==========
    if (command === 'unmute') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to unmute. Example: `.unmute 123456789012345678` or `.unmute @user`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to unmute someone.')] });
        }

        if (!targetMember.isCommunicationDisabled()) {
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is not muted.`)] });
        }

        try {
            await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
            const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unmute user.')] });
        }
    }

    // ========== WARN COMMAND (with auto-actions) ==========
    if (command === 'warn') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to warn. Example: `.warn 123456789012345678 reason here` or `.warn @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot warn yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to warn someone.')] });
        }

        if (targetMember) {
            const memberHighestRole = message.member.roles.highest;
            const targetHighestRole = targetMember.roles.highest;

            if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Cannot warn ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
            }
        }

        const reason = getReason(args.slice(1));
        const warnId = Math.floor(Date.now() / 1000).toString();
        const timestamp = new Date().toLocaleString();

        if (!warns.has(userId)) {
            warns.set(userId, []);
        }

        const userName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${userId})`;

        warns.get(userId).push({
            id: warnId,
            reason: reason,
            moderator: message.author.tag,
            moderatorId: message.author.id,
            timestamp: timestamp,
            userName: userName
        });

        saveWarnings();

        const warnCount = warns.get(userId).length;

        const actionTaken = await processWarnActions(userId, message.guild, message.author.id);

        let actionMessage = '';
        if (actionTaken) {
            actionMessage = `\n\n⚠️ **Auto-action triggered at ${warnCount} warnings!**`;
        }

        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember ? targetMember.user.toString() : `Unknown User (ID: ${userId})`}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}${actionMessage}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== UNWARN COMMAND ==========
    if (command === 'unwarn') {
        const userInput = args[0];
        const warnId = args[1];

        if (!userInput || !warnId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID/mention and a warning ID. Example: `.unwarn @user warningID` or `.unwarn 123456789012345678 warningID`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }

        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot remove your own warnings.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to remove warnings.')] });
        }

        if (!warns.has(userId)) {
            return message.reply({ embeds: [createErrorEmbed('Error', `This user has no warnings.`)] });
        }

        const userWarns = warns.get(userId);
        const warnIndex = userWarns.findIndex(w => w.id === warnId);

        if (warnIndex === -1) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a warning with ID ${warnId}. Use \`.warns\` to see warning IDs.`)] });
        }

        const removedWarn = userWarns[warnIndex];

        if (removedWarn.moderatorId !== message.author.id) {
            if (message.member.id !== message.guild.ownerId) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Cannot remove this warning - it was issued by ${removedWarn.moderator}. Only that moderator or an admin can remove it.`)] });
            }
        }

        userWarns.splice(warnIndex, 1);
        if (userWarns.length === 0) {
            warns.delete(userId);
        }

        saveWarnings();

        const embed = createSuccessEmbed('Warning Removed', `**User:** ${removedWarn.userName}\n\n**Removed Warning ID:** ${warnId}\n\n**Original Reason:** ${removedWarn.reason}\n\n**Original Moderator:** ${removedWarn.moderator}\n\n**Removed by:** ${message.author.toString()}\n\n**Remaining Warnings:** ${userWarns.length}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== HELP COMMAND ==========
    if (command === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('LawsHub | Help')
            .setDescription(`Prefix : \`.\`\n\n<:2904notifystaff:1497275164818280480>︱AFK\n\`- afk <reason>\`\n\n<:3007link:1497275170631450777>︱Ticket System\n\`- ticket claim\`\n\`- ticket transfer <@user>\`\n\`- ticket close <reason>\`\n\n<:7428whitemember:1497274951521275995>︱Owner \n\`- say\`\n\`- stats\`\n\`- adminlist\`\n\n<:5448staffwhite:1497275091539726418>︱Role Management\n\`- promote\`\n\`- demote\`\n\`- wipe\`\n\`- unwipe\`\n\n<:7240partnerwhite:1497275068265271446>︱Nickname\n\`- fn\`\n\`- rfn\`\n\n<:7964modbadgewhite:1497275047528628314>︱Channel\n\`- lock\`\n\`- unlock\`\n\`- purge\`\n\n<:56832developer:1497274968507941026>︱Punishments\n\`- ban\`\n\`- unban\`\n\`- iunban\`\n\`- kick\`\n\`- mute\`\n\`- unmute\`\n\n<:6304whitesmalldot:1497275082836414675>︱Warning system\n\`- warn\`\n\`- unwarn\`\n\`- warns\`\n\`- cw\``)
            .setColor(0x2A017F); // 2752767 decimal = 0x2A017F

        await message.reply({ embeds: [helpEmbed] });
    }
    
    // ========== WARNS COMMAND ==========
    if (command === 'warns') {
        let targetUserId = message.author.id;
        let targetUserName = message.author.tag;
        let isSelf = true;

        if (args[0]) {
            const userId = getUserIdFromInput(args[0]);
            if (userId) {
                targetUserId = userId;
                const targetMember = await message.guild.members.fetch(userId).catch(() => null);
                targetUserName = targetMember ? targetMember.user.tag : `Unknown User (ID: ${userId})`;
            }

            if (targetUserId !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to view other users\' warnings.')] });
            }
            isSelf = false;
        }

        const userWarns = warns.get(targetUserId) || [];

        if (userWarns.length === 0) {
            const embed = new EmbedBuilder()
                .setDescription(`**${targetUserName}** has no warnings.`)
                .setColor(0x00FF00)
                .setTimestamp();
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

        const embed = new EmbedBuilder()
            .setDescription(description)
            .setColor(0xFFA500)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
});

// Handle button interactions for tickets
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('ticket_')) return;
    
    const ticketType = interaction.customId.replace('ticket_', '');
    await createTicketChannel(interaction, ticketType);
    await interaction.deferUpdate().catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);

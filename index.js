const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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

// Persistent warnings storage
const WARNINGS_FILE = './warnings.json';
let warns = new Map();

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

// Save warnings to file
function saveWarnings() {
    const obj = Object.fromEntries(warns);
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(obj, null, 2));
    console.log(`💾 Saved warnings to file`);
}

loadWarnings();

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

function createSuccessEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n✅ Action Successful`)
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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    function getReason(argsArray, defaultReason = 'No reason provided') {
        const reason = argsArray.join(' ');
        if (!reason || reason.length === 0) return defaultReason;
        return reason;
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
            const reply = await message.channel.send({ embeds: [embed] });
            
            setTimeout(() => reply.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to purge messages. Messages may be older than 14 days.')] });
        }
    }

    // ========== PING COMMAND ==========
    if (command === 'ping') {
        const sent = await message.reply({ embeds: [createErrorEmbed('Pinging...', 'Calculating bot latency...')] });
        
        const wsLatency = client.ws.ping;
        const roundtripLatency = sent.createdTimestamp - message.createdTimestamp;
        
        let pingColor = 0x00FF00;
        let pingStatus = 'Excellent';
        
        if (wsLatency > 200) {
            pingColor = 0xFFA500;
            pingStatus = 'Mediocre';
        }
        if (wsLatency > 400) {
            pingColor = 0xFF0000;
            pingStatus = 'Bad';
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setDescription(`\`\`\`\n📡 WebSocket Latency: ${wsLatency}ms\n🔄 Round-trip Latency: ${roundtripLatency}ms\n📊 Status: ${pingStatus}\n⏰ Time: ${new Date().toLocaleString()}\n\`\`\``)
            .setColor(pingColor)
            .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();
        
        await sent.edit({ embeds: [embed] });
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
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server. Make sure the user is in the server.')] });
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
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to mute. Example: `.mute 123456789012345678 1h reason here` or `.mute @user 1h reason here`')] });
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
        
        if (!duration || !duration.match(/^\d+[mhd]$/)) {
            duration = '10m';
            reasonStart = 1;
        }
        
        const durationValue = parseInt(duration);
        const durationUnit = duration.slice(-1);
        
        switch(durationUnit) {
            case 'm': milliseconds = durationValue * 60 * 1000; break;
            case 'h': milliseconds = durationValue * 60 * 60 * 1000; break;
            case 'd': milliseconds = durationValue * 24 * 60 * 60 * 1000; break;
            default: milliseconds = 10 * 60 * 1000;
        }
        
        const reason = getReason(args.slice(reasonStart));

        try {
            await targetMember.timeout(milliseconds, `Muted by ${message.author.tag}: ${reason}`);
            const durationText = `${durationValue}${durationUnit === 'm' ? ' minute(s)' : durationUnit === 'h' ? ' hour(s)' : ' day(s)'}`;
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

    // ========== WARN COMMAND ==========
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
        
        if (!targetMember) {
            // User not in server, but we can still warn them by ID
            console.log(`User ${userId} not in server, warning will be stored by ID only`);
        }

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
        const warnId = Math.floor(Date.now() / 1000).toString(); // Unix timestamp as ID
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
        
        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember ? targetMember.user.toString() : `Unknown User (ID: ${userId})`}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}`);
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

    // ========== WARNS COMMAND (Styled like Carl-bot) ==========
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
        
        // Format warnings like Carl-bot
        let description = `**${userWarns.length} warning${userWarns.length !== 1 ? 's' : ''} found**\n\n`;
        
        // Sort warnings by ID (newest first)
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

client.login(process.env.DISCORD_TOKEN);

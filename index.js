const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Moderation
    ]
});

const PREFIX = '.';
const roleBackups = new Map();
const jailBackups = new Map();
const warns = new Map(); // Store warns: userId -> [{reason, moderator, timestamp, warnId}]

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

// Helper function to create success embed
function createSuccessEmbed(title, description, actionType) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n<:success:1495086393196675083> Action Successful`)
        .setColor(0x00FF00)
        .setTimestamp();
    return embed;
}

// Helper function to create error embed
function createErrorEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xFF0000)
        .setTimestamp();
    return embed;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Helper to extract reason from args
    function getReason(argsArray, defaultReason = 'No reason provided') {
        const reason = argsArray.join(' ');
        if (!reason || reason.length === 0) return defaultReason;
        return reason;
    }

    // ========== BAN COMMAND ==========
    if (command === 'ban') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to ban. Example: `.ban @user reason here`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
        // Prevent self-ban
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot ban yourself.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to ban someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission to ban someone.')] });
        }

        // Check role hierarchy
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
            const embed = createSuccessEmbed('User Banned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`, 'ban');
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to ban user.')] });
        }
    }

    // ========== UNBAN COMMAND ==========
    if (command === 'unban') {
        const userName = args[0];
        if (!userName) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or username#tag to unban. Example: `.unban username#1234`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            let bannedUser = bans.find(ban => ban.user.tag === userName || ban.user.id === userName);
            
            if (!bannedUser) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the ban list.')] });
            }

            // Check ban hierarchy (who banned them)
            const banEntry = await message.guild.bans.fetch(bannedUser.user.id);
            const banReason = banEntry.reason || 'No reason';
            
            // Extract who banned from reason (if possible)
            let bannerId = null;
            const bannerMatch = banReason.match(/Banned by (.+?):/);
            if (bannerMatch) {
                const bannerTag = bannerMatch[1];
                const bannerUser = await client.users.fetch({ query: bannerTag }).catch(() => null);
                if (bannerUser && bannerUser.first()) {
                    bannerId = bannerUser.first().id;
                }
            }
            
            if (bannerId && bannerId !== message.author.id) {
                const bannerMember = await message.guild.members.fetch(bannerId).catch(() => null);
                if (bannerMember && message.member.id !== message.guild.ownerId) {
                    const memberHighestRole = message.member.roles.highest;
                    const bannerHighestRole = bannerMember.roles.highest;
                    if (bannerHighestRole.position > memberHighestRole.position) {
                        return message.reply({ embeds: [createErrorEmbed('Error', `Cannot unban ${bannedUser.user.tag} - they were banned by someone with a higher role than you.`)] });
                    }
                }
            }

            await message.guild.members.unban(bannedUser.user.id, `Unbanned by ${message.author.tag}`);
            const embed = createSuccessEmbed('User Unbanned', `**User:** ${bannedUser.user.toString()}\n\n**Moderator:** ${message.author.toString()}`, 'unban');
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unban user.')] });
        }
    }

    // ========== KICK COMMAND ==========
    if (command === 'kick') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to kick. Example: `.kick @user reason here`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
        // Prevent self-kick
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot kick yourself.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Kick Members** permission to kick someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Kick Members** permission to kick someone.')] });
        }

        // Check role hierarchy
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
            const embed = createSuccessEmbed('User Kicked', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`, 'kick');
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to kick user.')] });
        }
    }

    // ========== MUTE COMMAND ==========
    if (command === 'mute') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to mute. Example: `.mute @user 1h reason here` (Time format: 10m, 1h, 1d)')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
        // Prevent self-mute
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot mute yourself.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to mute someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to mute someone.')] });
        }

        // Check role hierarchy
        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot mute ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        // Parse duration
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
            const embed = createSuccessEmbed('User Muted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Duration:** ${durationText}\n\n**Reason:** ${reason}`, 'mute');
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to mute user.')] });
        }
    }

    // ========== UNMUTE COMMAND ==========
    if (command === 'unmute') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to unmute. Example: `.unmute @user`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);

        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to unmute someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to unmute someone.')] });
        }

        if (!targetMember.isCommunicationDisabled()) {
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is not muted.`)] });
        }

        try {
            await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
            const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}`, 'unmute');
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unmute user.')] });
        }
    }

    // ========== WARN COMMAND ==========
    if (command === 'warn') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to warn. Example: `.warn @user reason here`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
        // Prevent self-warn
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot warn yourself.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to warn someone.')] });
        }

        const reason = getReason(args.slice(1));
        const warnId = Date.now().toString();

        if (!warns.has(userId)) {
            warns.set(userId, []);
        }

        warns.get(userId).push({
            id: warnId,
            reason: reason,
            moderator: message.author.tag,
            moderatorId: message.author.id,
            timestamp: new Date().toLocaleString()
        });

        const warnCount = warns.get(userId).length;
        
        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}`, 'warn');
        await message.reply({ embeds: [embed] });
    }

    // ========== UNWARN COMMAND ==========
    if (command === 'unwarn') {
        const targetMention = args[0];
        const warnId = args[1];
        
        if (!targetMention || !warnId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user and provide a warning ID. Example: `.unwarn @user warningID`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
        // Prevent self-unwarn
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot remove your own warnings.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to remove warnings.')] });
        }

        if (!warns.has(userId)) {
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} has no warnings.`)

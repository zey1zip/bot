const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

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
const warns = new Map();

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

// Helper function to create success embed
function createSuccessEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n✅ Action Successful`)
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

    function getReason(argsArray, defaultReason = 'No reason provided') {
        const reason = argsArray.join(' ');
        if (!reason || reason.length === 0) return defaultReason;
        return reason;
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
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to ban. Example: `.ban @user reason here`')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
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

    // ========== UNBAN COMMAND (FIXED - Works with ID) ==========
    if (command === 'unban') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID to unban. Example: `.unban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission to unban someone.')] });
        }

        try {
            // Fetch the ban list
            const bans = await message.guild.bans.fetch();
            
            // Find the user by ID (exact match)
            const banEntry = bans.get(userInput);
            
            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userInput}. Make sure the ID is correct.`)] });
            }

            const unbannedUser = banEntry.user;
            
            // Unban the user
            await message.guild.bans.remove(unbannedUser.id, `Unbanned by ${message.author.tag}`);
            
            const embed = createSuccessEmbed('User Unbanned', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unban user. Make sure the ID is correct and the user is banned.')] });
        }
    }

    // ========== IUNBAN COMMAND ==========
    if (command === 'iunban') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID to unban and DM. Example: `.iunban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userInput);
            
            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userInput}.`)] });
            }

            const unbannedUser = banEntry.user;
            
            await message.guild.bans.remove(unbannedUser.id, `Unbanned by ${message.author.tag}`);
            
            // Try to DM the user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('You have been unbanned!')
                    .setDescription(`You have been unbanned from **${message.guild.name}**.\n\nClick here to join back: https://discord.com/invite/Ur3gxVQSQH`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await unbannedUser.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`Could not DM ${unbannedUser.tag}`);
            }
            
            const embed = createSuccessEmbed('User Unbanned + DMed', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}\n\n**DM Sent:** Invite link was sent to the user.`);
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
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please mention a user to mute. Example: `.mute @user 1h reason here` (Time format: 10m, 1h, 1d)')] });
        }

        const userId = targetMention.replace(/[<@!>]/g, '');
        
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
            const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}`);
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

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot warn ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
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
        
        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}`);
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
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} has no warnings.`)] });
        }

        const userWarns = warns.get(userId);
        const warnIndex = userWarns.findIndex(w => w.id === warnId);
        
        if (warnIndex === -1) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a warning with ID ${warnId}. Use \`.warns\` to see your warning IDs or \`.warns @user\` to see theirs.`)] });
        }

        const removedWarn = userWarns[warnIndex];
        
        if (removedWarn.moderatorId !== message.author.id) {
            const originalWarner = await message.guild.members.fetch(removedWarn.moderatorId).catch(() => null);
            if (originalWarner && message.member.id !== message.guild.ownerId) {
                const memberHighestRole = message.member.roles.highest;
                const warnerHighestRole = originalWarner.roles.highest;
                if (warnerHighestRole.position > memberHighestRole.position) {
                    return message.reply({ embeds: [createErrorEmbed('Error', `Cannot remove this warning - it was issued by someone with a higher role than you (${removedWarn.moderator}).`)] });
                }
            }
        }

        userWarns.splice(warnIndex, 1);
        if (userWarns.length === 0) {
            warns.delete(userId);
        }

        const embed = createSuccessEmbed('Warning Removed', `**User:** ${targetMember.user.toString()}\n\n**Removed Warning ID:** ${warnId}\n\n**Original Reason:** ${removedWarn.reason}\n\n**Original Moderator:** ${removedWarn.moderator}\n\n**Removed by:** ${message.author.toString()}\n\n**Remaining Warnings:** ${userWarns.length}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== WARNS COMMAND ==========
    if (command === 'warns') {
        let targetMember = message.member;
        let isSelf = true;
        
        if (args[0]) {
            const targetMention = args[0];
            const userId = targetMention.replace(/[<@!>]/g, '');
            targetMember = await message.guild.members.fetch(userId).catch(() => null);
            
            if (!targetMember) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
            }
            
            if (userId !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to view other users\' warnings.')] });
            }
            isSelf = false;
        }
        
        const userWarns = warns.get(targetMember.id) || [];
        
        if (userWarns.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`Warnings for ${targetMember.user.tag}`)
                .setDescription(`${isSelf ? 'You have' : 'This user has'} no warnings.`)
                .setColor(0x00FF00)
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }
        
        let description = `**Total Warnings:** ${userWarns.length}\n\n`;
        userWarns.forEach((warn, index) => {
            description += `**Warning #${index + 1} (ID: ${warn.id})**\n`;
            description += `📝 Reason: ${warn.reason}\n`;
            description += `👤 Moderator: ${warn.moderator}\n`;
            description += `⏰ Time: ${warn.timestamp}\n\n`;
        });
        
        const embed = new EmbedBuilder()
            .setTitle(`Warnings for ${targetMember.user.tag}`)
            .setDescription(description.substring(0, 4096))
            .setColor(0xFFA500)
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);

const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = '.';
const roleBackups = new Map(); // For wipe/unwipe
const jailBackups = new Map(); // For jail/unjail

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

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

        // Get all roles the user has (excluding @everyone)
        const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
        
        if (userRoles.size === 0) {
            return message.reply(`${targetMember.user.tag} has no roles to promote from.`);
        }

        // Find the highest role the user has
        const highestUserRole = userRoles.sort((a, b) => b.position - a.position).first();
        
        // Find the next higher role in the server (above their current highest)
        const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
        const sortedRoles = allRoles.sort((a, b) => b.position - a.position);
        
        let nextRole = null;
        let foundCurrent = false;
        
        for (const role of sortedRoles.values()) {
            if (foundCurrent) {
                nextRole = role;
                break;
            }
            if (role.id === highestUserRole.id) {
                foundCurrent = true;
            }
        }
        
        if (!nextRole) {
            return message.reply(`${targetMember.user.tag} already has the highest role in the server!`);
        }
        
        // Check bot role hierarchy
        const highestBotRole = botMember.roles.highest;
        if (nextRole.position >= highestBotRole.position) {
            return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to my highest role.`);
        }
        
        // Check if the moderator can manage the next role
        const memberHighestRole = message.member.roles.highest;
        if (nextRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to your highest role.`);
        }

        try {
            // Remove the old role and add the new one
            await targetMember.roles.remove(highestUserRole);
            await targetMember.roles.add(nextRole);
            
            await message.reply(`**${targetMember.user.tag} has been promoted!**\n 📈 **Role change:** ${highestUserRole.name} → ${nextRole.name}\n 👤 **Moderator:** ${message.author.tag}`);
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

        // Get all roles the user has (excluding @everyone)
        const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
        
        if (userRoles.size === 0) {
            return message.reply(`${targetMember.user.tag} has no roles to demote from.`);
        }

        // Find the lowest role the user has (excluding @everyone)
        const lowestUserRole = userRoles.sort((a, b) => a.position - b.position).first();
        
        // Find the next lower role in the server (below their current lowest)
        const allRoles = message.guild.roles.cache.filter(role => role.name !== '@everyone');
        const sortedRoles = allRoles.sort((a, b) => a.position - b.position);
        
        let nextRole = null;
        let foundCurrent = false;
        
        for (const role of sortedRoles.values()) {
            if (foundCurrent) {
                nextRole = role;
                break;
            }
            if (role.id === lowestUserRole.id) {
                foundCurrent = true;
            }
        }
        
        if (!nextRole) {
            return message.reply(`${targetMember.user.tag} already has the lowest role in the server!`);
        }
        
        // Check bot role hierarchy
        const highestBotRole = botMember.roles.highest;
        if (nextRole.position >= highestBotRole.position && nextRole.position !== lowestUserRole.position) {
            // This is a warning, but we can still try
            console.log(`Warning: Next role ${nextRole.name} is high in hierarchy`);
        }

        try {
            // Remove the old role and add the new one
            await targetMember.roles.remove(lowestUserRole);
            await targetMember.roles.add(nextRole);
            
            await message.reply(`**${targetMember.user.tag} has been demoted!**\n 📉 **Role change:** ${lowestUserRole.name} → ${nextRole.name}\n 👤 **Moderator:** ${message.author.tag}`);
        } catch (error) {
            console.error(error);
            await message.reply('Failed to demote user.');
        }
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
            roleBackups.set(targetMember.id, roleIds);

            await targetMember.roles.set([], `Wiped by ${message.author.tag} (${message.author.id})`);

            await message.reply(`Successfully wiped all roles from ${targetMember.user.tag}`);

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
            return message.reply(`No wiped roles found for ${targetMember.user.tag}. Try wiping them first.`);
        }

        try {
            const rolesToRestore = [];
            for (const roleId of backupRoleIds) {
                const role = message.guild.roles.cache.get(roleId);
                if (role) {
                    rolesToRestore.push(role);
                }
            }

            if (rolesToRestore.length === 0) {
                return message.reply('Cannot restore - the original roles no longer exist.');
            }

            await targetMember.roles.add(rolesToRestore, `Restored by ${message.author.tag} (${message.author.id})`);
            roleBackups.delete(targetMember.id);
            await message.reply(`Successfully restored roles to ${targetMember.user.tag}`);

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

        const jailRoleName = 'Jailed';
        const jailRole = message.guild.roles.cache.find(role => role.name === jailRoleName);

        if (!jailRole) {
            return message.reply(`Could not find a role named "${jailRoleName}". Please create it first.`);
        }

        const highestBotRole = botMember.roles.highest;
        if (jailRole.position >= highestBotRole.position) {
            return message.reply(`The ${jailRoleName} role is higher than or equal to my highest role. Please move my role above the ${jailRoleName} role.`);
        }

        if (targetMember.roles.cache.has(jailRole.id)) {
            return message.reply(`${targetMember.user.tag} is already jailed!`);
        }

        try {
            const rolesToBackup = targetMember.roles.cache.filter(role => role.name !== '@everyone' && role.id !== jailRole.id);
            const roleIds = rolesToBackup.map(role => role.id);
            jailBackups.set(targetMember.id, roleIds);

            await targetMember.roles.set([jailRole], `Jailed by ${message.author.tag} (${message.author.id})`);

            await message.reply(`**${targetMember.user.tag} has been jailed!**\n **Moderator:** ${message.author.tag}`);

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

        const jailRoleName = 'Jailed';
        const jailRole = message.guild.roles.cache.find(role => role.name === jailRoleName);

        if (!jailRole) {
            return message.reply(`Could not find a role named "${jailRoleName}".`);
        }

        if (!targetMember.roles.cache.has(jailRole.id)) {
            return message.reply(`${targetMember.user.tag} is not jailed.`);
        }

        try {
            const backupRoleIds = jailBackups.get(targetMember.id);
            const rolesToRestore = [];

            if (backupRoleIds && backupRoleIds.length > 0) {
                for (const roleId of backupRoleIds) {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role) {
                        rolesToRestore.push(role);
                    }
                }
            }

            await targetMember.roles.set(rolesToRestore, `Unjailed by ${message.author.tag} (${message.author.id})`);
            jailBackups.delete(targetMember.id);

            await message.reply(`**${targetMember.user.tag} has been unjailed!**\n **Moderator:** ${message.author.tag}`);

        } catch (error) {
            console.error(error);
            await message.reply('Failed to unjail user.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

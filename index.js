const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

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
    // ========== PROMOTE COMMAND ==========
    if (command === 'promote') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to promote. Example: `.promote @user` or `.promote @user RoleName` or `.promote @user RoleName reason here`');
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

        let reason = 'No reason provided';
        let roleName = args.slice(1).join(' ');
        
        const reasonKeywords = ['reason', 'because', 'for:', '-reason', '--reason'];
        let reasonIndex = -1;
        
        for (const keyword of reasonKeywords) {
            const index = roleName.toLowerCase().indexOf(keyword);
            if (index !== -1) {
                reasonIndex = index;
                break;
            }
        }
        
        if (reasonIndex !== -1) {
            reason = roleName.substring(reasonIndex).replace(/reason|because|for:|-reason|--reason/gi, '').trim();
            roleName = roleName.substring(0, reasonIndex).trim();
        } else if (roleName.includes(' - ')) {
            const parts = roleName.split(' - ');
            roleName = parts[0];
            reason = parts.slice(1).join(' - ');
        }
        
        let targetRole = null;
        let oldRole = null;
        let oldRoleName = 'None';
        let oldRoleMention = 'None';
        
        if (roleName) {
            targetRole = message.guild.roles.cache.find(role => 
                role.name.toLowerCase() === roleName.toLowerCase()
            );
            
            if (!targetRole) {
                return message.reply(`Could not find a role named "${roleName}".`);
            }
            
            if (targetMember.roles.cache.has(targetRole.id)) {
                return message.reply(`${targetMember.user.tag} already has the ${targetRole.name} role.`);
            }
            
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            if (userRoles.size > 0) {
                oldRole = userRoles.sort((a, b) => b.position - a.position).first();
                oldRoleName = oldRole.name;
                oldRoleMention = `<@&${oldRole.id}>`;
            }
            
            const highestBotRole = botMember.roles.highest;
            if (targetRole.position >= highestBotRole.position) {
                return message.reply(`Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to my highest role.`);
            }
            
            const memberHighestRole = message.member.roles.highest;
            if (targetRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
                return message.reply(`Cannot promote ${targetMember.user.tag} to ${targetRole.name} - that role is higher than or equal to your highest role.`);
            }
            
            try {
                if (oldRole) {
                    await targetMember.roles.remove(oldRole, `Promoted by ${message.author.tag}: ${reason}`);
                }
                await targetMember.roles.add(targetRole, `Promoted by ${message.author.tag}: ${reason}`);
                
                const embed = new EmbedBuilder()
                    .setTitle('LawsHub Promotion')
                    .setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleMention}\n\n**Current role:** ${targetRole.toString()}\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`)
                    .setColor(0x00FF00);
                
                await message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                await message.reply('Failed to promote user.');
            }
        } else {
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            
            if (userRoles.size === 0) {
                return message.reply(`${targetMember.user.tag} has no roles to promote from. Use \`.promote @user RoleName\` to give them a specific role.`);
            }

            const highestUserRole = userRoles.sort((a, b) => b.position - a.position).first();
            oldRoleName = highestUserRole.name;
            oldRoleMention = `<@&${highestUserRole.id}>`;
            
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
            
            const highestBotRole = botMember.roles.highest;
            if (nextRole.position >= highestBotRole.position) {
                return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to my highest role.`);
            }
            
            const memberHighestRole = message.member.roles.highest;
            if (nextRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
                return message.reply(`Cannot promote ${targetMember.user.tag} to ${nextRole.name} - that role is higher than or equal to your highest role.`);
            }

            try {
                await targetMember.roles.remove(highestUserRole, `Promoted by ${message.author.tag}: ${reason}`);
                await targetMember.roles.add(nextRole, `Promoted by ${message.author.tag}: ${reason}`);
                
                const embed = new EmbedBuilder()
                    .setTitle('LawsHub Promotion')
                    .setDescription(`**User Promoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleMention}\n\n**Current role:** ${nextRole.toString()}\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`)
                    .setColor(0x00FF00);
                
                await message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                await message.reply('Failed to promote user.');
            }
        }
    }

    // ========== DEMOTE COMMAND ==========
    // ========== DEMOTE COMMAND ==========
    if (command === 'demote') {
        const targetMention = args[0];
        if (!targetMention) {
            return message.reply('Please mention a user to demote. Example: `.demote @user` or `.demote @user RoleName` or `.demote @user RoleName reason here`');
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

        let reason = 'No reason provided';
        let roleName = args.slice(1).join(' ');
        
        const reasonKeywords = ['reason', 'because', 'for:', '-reason', '--reason'];
        let reasonIndex = -1;
        
        for (const keyword of reasonKeywords) {
            const index = roleName.toLowerCase().indexOf(keyword);
            if (index !== -1) {
                reasonIndex = index;
                break;
            }
        }
        
        if (reasonIndex !== -1) {
            reason = roleName.substring(reasonIndex).replace(/reason|because|for:|-reason|--reason/gi, '').trim();
            roleName = roleName.substring(0, reasonIndex).trim();
        } else if (roleName.includes(' - ')) {
            const parts = roleName.split(' - ');
            roleName = parts[0];
            reason = parts.slice(1).join(' - ');
        }
        
        let targetRole = null;
        let oldRoleName = 'None';
        let oldRoleMention = 'None';
        let newRoleMention = 'Removed';
        
        if (roleName) {
            targetRole = message.guild.roles.cache.find(role => 
                role.name.toLowerCase() === roleName.toLowerCase()
            );
            
            if (!targetRole) {
                return message.reply(`Could not find a role named "${roleName}".`);
            }
            
            if (!targetMember.roles.cache.has(targetRole.id)) {
                return message.reply(`${targetMember.user.tag} does not have the ${targetRole.name} role.`);
            }
            
            oldRoleName = targetRole.name;
            oldRoleMention = targetRole.toString();
            
            const highestBotRole = botMember.roles.highest;
            if (targetRole.position >= highestBotRole.position) {
                return message.reply(`Cannot demote ${targetMember.user.tag} from ${targetRole.name} - that role is higher than or equal to my highest role.`);
            }
            
            try {
                await targetMember.roles.remove(targetRole, `Demoted by ${message.author.tag}: ${reason}`);
                
                const embed = new EmbedBuilder()
                    .setTitle('LawsHub Demotion')
                    .setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleMention}\n\n**Current role:** Removed\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`)
                    .setColor(0xFF0000);
                
                await message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                await message.reply('Failed to demote user.');
            }
        } else {
            const userRoles = targetMember.roles.cache.filter(role => role.name !== '@everyone');
            
            if (userRoles.size === 0) {
                return message.reply(`${targetMember.user.tag} has no roles to demote from.`);
            }

            const lowestUserRole = userRoles.sort((a, b) => a.position - b.position).first();
            oldRoleName = lowestUserRole.name;
            oldRoleMention = `<@&${lowestUserRole.id}>`;
            
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
            
            newRoleMention = nextRole.toString();

            try {
                await targetMember.roles.remove(lowestUserRole, `Demoted by ${message.author.tag}: ${reason}`);
                await targetMember.roles.add(nextRole, `Demoted by ${message.author.tag}: ${reason}`);
                
                const embed = new EmbedBuilder()
                    .setTitle('LawsHub Demotion')
                    .setDescription(`**User Demoted** ${targetMember.user.toString()}\n\n**Previous role:** ${oldRoleMention}\n\n**Current role:** ${newRoleMention}\n\n**Time:** ${new Date().toLocaleString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`)
                    .setColor(0xFF0000);
                
                await message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                await message.reply('Failed to demote user.');
            }
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

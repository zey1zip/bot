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

const roleBackups = new Map();

client.on('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

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
            return message.reply('❌ I need **Manage Roles** permission.');
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

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('❌ I need **Manage Roles** permission.');
        }

        const backupRoleIds = roleBackups.get(targetMember.id);
        if (!backupRoleIds || backupRoleIds.length === 0) {
            return message.reply(`No wiped roles found for ${targetMember.user.tag}. The bot may have restarted since the wipe.`);
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
                return message.reply('Cannot restore.');
            }

            await targetMember.roles.add(rolesToRestore, `Restored by ${message.author.tag} (${message.author.id})`);

            roleBackups.delete(targetMember.id);

            await message.reply(`Successfully restored roles to ${targetMember.user.tag}`);

        } catch (error) {
            console.error(error);
            await message.reply('Failed to restore roles.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

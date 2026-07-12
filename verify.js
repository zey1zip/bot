const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { createCanvas } = require('canvas');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = '.';
const VERIFY_CHANNEL_ID = '1495210070496248039';
const VERIFIED_ROLE_ID = '1495209173086896158';

// Custom emoji IDs
const EMOJIS = {
    error: '1498064431458947123',
    success: '1498072459029512262',
    verify: '1500822275052802078',
    timer: '1500821434795167756',
    attempts: '1500821985121407037',
    enter: '1500827498798387320',
    refresh: '1500825193705246851',
    cancel: '1500827075932852356'
};

const activeCaptchas = new Map();
const refreshCooldowns = new Map();

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_REFRESHES = 2;
const COOLDOWN_WINDOW = 120000;

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
    console.log('Verify Bot Ready!');
});

function generateCaptchaCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
    }
    return code;
}

function isRateLimited(userId) {
    const data = refreshCooldowns.get(userId);
    if (!data) return false;
    if (Date.now() - data.firstRefreshTime > COOLDOWN_WINDOW) {
        refreshCooldowns.delete(userId);
        return false;
    }
    return data.count >= MAX_REFRESHES;
}

function recordRefresh(userId) {
    const existing = refreshCooldowns.get(userId);
    if (!existing) {
        refreshCooldowns.set(userId, { count: 1, firstRefreshTime: Date.now() });
        return;
    }
    existing.count++;
    refreshCooldowns.set(userId, existing);
}

function getRemainingRefreshes(userId) {
    const data = refreshCooldowns.get(userId);
    if (!data) return MAX_REFRESHES;
    if (Date.now() - data.firstRefreshTime > COOLDOWN_WINDOW) {
        refreshCooldowns.delete(userId);
        return MAX_REFRESHES;
    }
    return Math.max(0, MAX_REFRESHES - data.count);
}

async function generateCaptchaImage(code) {
    const width = 550;
    const height = 200;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f0f0f0');
    gradient.addColorStop(1, '#e0e0e0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 800; i++) {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.15})`;
        ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
    }

    for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        const startX = Math.random() * width;
        const startY = Math.random() * height;
        ctx.moveTo(startX, startY);
        for (let j = 0; j < 5; j++) {
            ctx.lineTo(startX + (Math.random() - 0.5) * 100, startY + (Math.random() - 0.5) * 50);
        }
        ctx.strokeStyle = `rgba(100, 100, 150, ${Math.random() * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    const chars = code.split('');
    const startX = 50;
    const charWidth = (width - 100) / chars.length;

    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const x = startX + (i * charWidth) + (Math.random() * 12 - 6);
        const y = height / 2 + 20 + (Math.random() * 15 - 7);
        const rotation = (Math.random() - 0.5) * 0.25;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        
        const colors = ['#1a1a2e', '#16213e', '#0f3460', '#2c3e50', '#34495e', '#2c3e66'];
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.font = `bold ${52 + Math.random() * 8}px "Arial", "Helvetica", sans-serif`;
        ctx.shadowBlur = 2;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.fillText(char, 0, 0);
        
        ctx.restore();
    }

    for (let i = 0; i < 15; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * width, Math.random() * height);
        ctx.lineTo(Math.random() * width, Math.random() * height);
        ctx.strokeStyle = `rgba(50, 50, 80, 0.25)`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    ctx.strokeStyle = '#2B017F';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, width, height);

    return canvas.toBuffer();
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'verifypanel') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply(`<:unknown:${EMOJIS.error}> You need Administrator permission to use this command.`);
        }

        const targetChannel = message.mentions.channels.first() || message.channel;
        
        const panelEmbed = new EmbedBuilder()
            .setTitle(`<:unknown:${EMOJIS.verify}> | LawsHub Verification`)
            .setDescription('To access the server, you must verify that you are human.\n\nClick the **Verify** button below to start the verification process.')
            .setColor(0x2B017F)
            .setFooter({ text: 'Verification System' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_start')
                    .setLabel('Verify')
                    .setEmoji('🔓')
                    .setStyle(ButtonStyle.Success)
            );

        await targetChannel.send({ embeds: [panelEmbed], components: [row] });
        await message.reply(`<:unknown:${EMOJIS.success}> Verification panel sent to ${targetChannel.toString()}`);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId === 'verify_start') {
            const captchaCode = generateCaptchaCode(6);
            const expiresAt = Date.now() + 5 * 60 * 1000;
            
            refreshCooldowns.delete(interaction.user.id);
            
            activeCaptchas.set(interaction.user.id, {
                code: captchaCode,
                expiresAt: expiresAt,
                attempts: 0
            });

            const imageBuffer = await generateCaptchaImage(captchaCode);
            
            const captchaEmbed = new EmbedBuilder()
                .setTitle(`<:unknown:${EMOJIS.verify}> LawsHub Verification`)
                .setDescription(`**Type the exact code you see in the image below.**\n\n<:unknown:${EMOJIS.timer}> Expires in 5 minutes\n<:unknown:${EMOJIS.attempts}> 3 attempts remaining\n\n**Format:** Uppercase letters and numbers, no spaces`)
                .setColor(0x2B017F)
                .setImage('attachment://captcha.png')
                .setFooter({ text: 'Enter the code exactly as shown' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_enter')
                        .setLabel('Enter Code')
                        .setEmoji(EMOJIS.enter)
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('verify_refresh')
                        .setLabel('New Code')
                        .setEmoji(EMOJIS.refresh)
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('verify_cancel')
                        .setLabel('Cancel')
                        .setEmoji(EMOJIS.cancel)
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.reply({ 
                embeds: [captchaEmbed], 
                components: [row], 
                files: [{ attachment: imageBuffer, name: 'captcha.png' }],
                ephemeral: true 
            });
        }

        if (interaction.customId === 'verify_refresh') {
            const captchaData = activeCaptchas.get(interaction.user.id);
            
            if (!captchaData) {
                return interaction.update({ 
                    content: `<:unknown:${EMOJIS.error}> No active verification found. Please start over.`, 
                    embeds: [], 
                    components: [], 
                    files: [] 
                });
            }

            if (isRateLimited(interaction.user.id)) {
                const remainingTime = Math.ceil((COOLDOWN_WINDOW - (Date.now() - refreshCooldowns.get(interaction.user.id).firstRefreshTime)) / 1000);
                const minutes = Math.floor(remainingTime / 60);
                const seconds = remainingTime % 60;
                return interaction.update({ 
                    content: `<:unknown:${EMOJIS.error}> You've reached the maximum of ${MAX_REFRESHES} refreshes. Please wait ${minutes}m ${seconds}s before requesting a new code.`, 
                    embeds: [], 
                    components: [], 
                    files: [] 
                });
            }

            const remainingRefreshes = getRemainingRefreshes(interaction.user.id);
            
            const newCode = generateCaptchaCode(6);
            captchaData.code = newCode;
            captchaData.expiresAt = Date.now() + 5 * 60 * 1000;
            activeCaptchas.set(interaction.user.id, captchaData);
            
            recordRefresh(interaction.user.id);

            const imageBuffer = await generateCaptchaImage(newCode);
            
            const captchaEmbed = new EmbedBuilder()
                .setTitle(`<:unknown:${EMOJIS.verify}> | Human Verification`)
                .setDescription(`**Type the exact code you see in the image below.**\n\n<:unknown:${EMOJIS.timer}> Expires in 5 minutes\n<:unknown:${EMOJIS.attempts}> 3 attempts remaining\n\n**Refreshes remaining:** ${remainingRefreshes - 1}/${MAX_REFRESHES}\n\n**Format:** Uppercase letters and numbers, no spaces`)
                .setColor(0x2B017F)
                .setImage('attachment://captcha.png')
                .setFooter({ text: 'Enter the code exactly as shown' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_enter')
                        .setLabel('Enter Code')
                        .setEmoji(EMOJIS.enter)
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('verify_refresh')
                        .setLabel(`New Code (${remainingRefreshes - 1} left)`)
                        .setEmoji(EMOJIS.refresh)
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('verify_cancel')
                        .setLabel('Cancel')
                        .setEmoji(EMOJIS.cancel)
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                embeds: [captchaEmbed], 
                components: [row], 
                files: [{ attachment: imageBuffer, name: 'captcha.png' }]
            });
        }

        if (interaction.customId === 'verify_cancel') {
            activeCaptchas.delete(interaction.user.id);
            refreshCooldowns.delete(interaction.user.id);
            await interaction.update({ 
                content: `<:unknown:${EMOJIS.error}> | Verification cancelled.`, 
                embeds: [], 
                components: [], 
                files: [] 
            });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
        }

        if (interaction.customId === 'verify_enter') {
            const captchaData = activeCaptchas.get(interaction.user.id);
            
            if (!captchaData) {
                return interaction.reply({ 
                    content: `<:unknown:${EMOJIS.error}> | No active verification found. Please start over.`, 
                    ephemeral: true 
                });
            }

            if (Date.now() > captchaData.expiresAt) {
                activeCaptchas.delete(interaction.user.id);
                refreshCooldowns.delete(interaction.user.id);
                return interaction.reply({ 
                    content: `<:unknown:${EMOJIS.error}> | Captcha code has expired. Please start over.`, 
                    ephemeral: true 
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`verify_modal_${interaction.user.id}`)
                .setTitle('Verify Captcha');

            const codeInput = new TextInputBuilder()
                .setCustomId('captcha_code')
                .setLabel('Enter the 6-character code from the image')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Example: A1B2C3')
                .setRequired(true)
                .setMaxLength(6)
                .setMinLength(6);

            const row = new ActionRowBuilder().addComponents(codeInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === `verify_modal_${interaction.user.id}`) {
            const captchaData = activeCaptchas.get(interaction.user.id);
            
            if (!captchaData) {
                return interaction.reply({ 
                    content: `<:unknown:${EMOJIS.error}> | No active verification found. Please start over.`, 
                    ephemeral: true 
                });
            }

            if (Date.now() > captchaData.expiresAt) {
                activeCaptchas.delete(interaction.user.id);
                refreshCooldowns.delete(interaction.user.id);
                return interaction.reply({ 
                    content: `<:unknown:${EMOJIS.error}> | Captcha code has expired. Please start over.`, 
                    ephemeral: true 
                });
            }

            const enteredCode = interaction.fields.getTextInputValue('captcha_code').toUpperCase();
            captchaData.attempts++;

            if (enteredCode === captchaData.code) {
                activeCaptchas.delete(interaction.user.id);
                refreshCooldowns.delete(interaction.user.id);
                
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
                
                if (!verifiedRole) {
                    return interaction.reply({ 
                        content: `<:unknown:${EMOJIS.error}> | Verification role not found. Please contact an administrator.`, 
                        ephemeral: true 
                    });
                }

                try {
                    await member.roles.add(verifiedRole);
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle(`<:unknown:${EMOJIS.success}> Verification Successful!`)
                        .setDescription(`Welcome to **${interaction.guild.name}**!\n\nYou have been verified and granted access to the server.`)
                        .setColor(0x00FF00)
                        .setTimestamp();

                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ 
                        content: `<:unknown:${EMOJIS.error}> Failed to assign verified role. Please contact an administrator.`, 
                        ephemeral: true 
                    });
                }
            } else {
                if (captchaData.attempts >= 3) {
                    activeCaptchas.delete(interaction.user.id);
                    refreshCooldowns.delete(interaction.user.id);
                    return interaction.reply({ 
                        content: `<:unknown:${EMOJIS.error}> You have exceeded the maximum number of attempts (3). Please start over.`, 
                        ephemeral: true 
                    });
                }
                
                const remainingAttempts = 3 - captchaData.attempts;
                const imageBuffer = await generateCaptchaImage(captchaData.code);
                
                const captchaEmbed = new EmbedBuilder()
                    .setTitle(`<:unknown:${EMOJIS.verify}> Human Verification - Try Again`)
                    .setDescription(`<:unknown:${EMOJIS.error}> **Incorrect code!** You have ${remainingAttempts} attempt(s) remaining.\n\n**Type the exact code you see in the image below.**`)
                    .setColor(0xFF0000)
                    .setImage('attachment://captcha.png')
                    .setFooter({ text: 'Enter the code exactly as shown' })
                    .setTimestamp();

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('verify_enter')
                            .setLabel(`Try Again (${remainingAttempts} left)`)
                            .setEmoji(EMOJIS.success)
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('verify_refresh')
                            .setLabel('New Code')
                            .setEmoji(EMOJIS.refresh)
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('verify_cancel')
                            .setLabel('Cancel')
                            .setEmoji(EMOJIS.cancel)
                            .setStyle(ButtonStyle.Danger)
                    );

                await interaction.reply({ 
                    embeds: [captchaEmbed], 
                    components: [row], 
                    files: [{ attachment: imageBuffer, name: 'captcha.png' }],
                    ephemeral: true 
                });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

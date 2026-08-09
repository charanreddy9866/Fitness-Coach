const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const COACH_PROMPT = 'You are an elite personal fitness coach with 15 years of experience.\n\nRULES:\n1. When creating workouts:\n   - Format each exercise on a new line\n   - Format: Exercise Name | Sets x Reps | Weight | Notes\n   - Example: Bench Press | 4x6-8 | 185lbs | Rest 3 min\n   - Always include 6-8 exercises per workout\n   - Match exercises to user fitness level\n   - Avoid exercises that affect any injuries mentioned\n\n2. When user logs a workout:\n   - Acknowledge their effort with specific feedback\n   - Point out form cues if applicable\n\n3. Adapt to user goals:\n   - Strength: Heavy weights, low reps (3-6), long rest\n   - Hypertrophy: Medium weights, medium reps (8-12)\n   - Endurance: Light weights, high reps (12-15+)\n   - Weight loss: Compound movements, some cardio\n\n4. Be encouraging, knowledgeable, and results-focused.';

async function askAI(prompt) {
  var chatCompletion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: COACH_PROMPT },
      { role: 'user', content: prompt },
    ],
    model: 'llama-3.1-8b-instant',
    max_tokens: 1024,
  });
  return chatCompletion.choices[0].message.content;
}

// ===== STREAK UTILITIES =====
async function calculateAndUpdateStreak(discordId, supabase) {
  try {
    // Get user's current data (using discord_id to find them)
    const userResult = await supabase
      .from('users')
      .select('current_streak, longest_streak, last_workout_date, streak_milestones')
      .eq('discord_id', discordId)
      .single();

    if (userResult.error) {
      console.error('Error fetching user for streak:', userResult.error);
      return { success: false, error: userResult.error };
    }

    const userData = userResult.data;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const lastWorkoutDate = userData.last_workout_date;
    let newStreak = userData.current_streak || 0;
    let longestStreak = userData.longest_streak || 0;
    let streakReset = false;

    // Streak calculation logic
    if (!lastWorkoutDate) {
      // First workout ever
      newStreak = 1;
    } else {
      const lastDate = new Date(lastWorkoutDate);
      const todayDate = new Date(today);
      const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        // Consecutive day - increment streak
        newStreak += 1;
      } else if (daysDiff === 0) {
        // Already worked out today - don't change streak
        return { success: true, streak: newStreak, isNewDay: false };
      } else {
        // Gap detected - reset streak but keep history
        newStreak = 1;
        streakReset = true;
      }
    }

    // Update longest streak if needed
    if (newStreak > longestStreak) {
      longestStreak = newStreak;
    }

    // Check for milestone badges
    const milestones = userData.streak_milestones || {};
    const milestoneDays = [7, 14, 30, 60, 100];
    let unlockedBadges = [];

    for (const day of milestoneDays) {
      if (newStreak >= day && !milestones[day]) {
        milestones[day] = true;
        unlockedBadges.push(day);
      }
    }

    // Update database
    const updateResult = await supabase
      .from('users')
      .update({
        current_streak: newStreak,
        longest_streak: longestStreak,
        last_workout_date: today,
        streak_milestones: milestones,
      })
      .eq('discord_id', discordId);

    if (updateResult.error) {
      console.error('Error updating streak:', updateResult.error);
      return { success: false, error: updateResult.error };
    }

    return {
      success: true,
      streak: newStreak,
      longestStreak: longestStreak,
      streakReset: streakReset,
      unlockedBadges: unlockedBadges,
      isNewDay: true,
    };
  } catch (error) {
    console.error('Streak calculation error:', error);
    return { success: false, error: error };
  }
}

function getStreakBadge(streakDays) {
  if (streakDays >= 100) return '👑 Unstoppable';
  if (streakDays >= 60) return '💪 Beast Mode';
  if (streakDays >= 30) return '🔥🔥🔥 Legend';
  if (streakDays >= 14) return '🔥🔥 Warrior';
  if (streakDays >= 7) return '🔥 Starter';
  return '';
}

function getStreakVisual(streakDays) {
  // Create a visual representation
  const fireEmojis = Math.min(Math.ceil(streakDays / 10), 10);
  return '🔥'.repeat(fireEmojis);
}

// ===== END STREAK UTILITIES =====

client.once('ready', function() {
  console.log('');
  console.log('=================================');
  console.log('  AI FITNESS COACH BOT IS LIVE!');
  console.log('=================================');
  console.log('Bot name: ' + client.user.tag);
  console.log('Servers: ' + client.guilds.cache.size);
  console.log('AI: Groq Llama 3.1 (Free Tier)');
  console.log('');
  registerCommands();
});

async function registerCommands() {
  var commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Create your fitness profile')
      .addStringOption(function(option) {
        return option.setName('level').setDescription('Your fitness level').setRequired(true)
          .addChoices(
            { name: 'Beginner', value: 'beginner' },
            { name: 'Intermediate', value: 'intermediate' },
            { name: 'Advanced', value: 'advanced' }
          );
      })
      .addStringOption(function(option) {
        return option.setName('goal').setDescription('Your fitness goal').setRequired(true)
          .addChoices(
            { name: 'Build Strength', value: 'strength' },
            { name: 'Build Muscle', value: 'hypertrophy' },
            { name: 'Build Endurance', value: 'endurance' },
            { name: 'Lose Weight', value: 'weight_loss' }
          );
      })
      .addStringOption(function(option) {
        return option.setName('injuries').setDescription('Any injuries? (optional)').setRequired(false);
      }),

    new SlashCommandBuilder()
      .setName('workout')
      .setDescription('Get a personalized workout for today'),

    new SlashCommandBuilder()
      .setName('log')
      .setDescription('Log an exercise you completed')
      .addStringOption(function(option) {
        return option.setName('exercise').setDescription('Exercise name').setRequired(true);
      })
      .addIntegerOption(function(option) {
        return option.setName('sets').setDescription('Number of sets').setRequired(true);
      })
      .addIntegerOption(function(option) {
        return option.setName('reps').setDescription('Reps per set').setRequired(true);
      })
      .addNumberOption(function(option) {
        return option.setName('weight').setDescription('Weight in pounds (optional)').setRequired(false);
      })
      .addStringOption(function(option) {
        return option.setName('notes').setDescription('How did it feel? (optional)').setRequired(false);
      }),

    new SlashCommandBuilder()
      .setName('history')
      .setDescription('See your last 10 logged exercises'),

    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('View your fitness statistics'),

    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your fitness profile'),
    
    new SlashCommandBuilder()
  .setName('weekly')
  .setDescription('View your weekly progress report'),

    new SlashCommandBuilder()
      .setName('streak')
      .setDescription('View your workout streak and milestone badges'),

    new SlashCommandBuilder()
      .setName('coach')
      .setDescription('Ask the coach anything about fitness')
      .addStringOption(function(option) {
        return option.setName('question').setDescription('Your fitness question').setRequired(true);
      }),
  ];

  var guild = client.guilds.cache.first();
  if (guild) {
    await guild.commands.set(commands);
    console.log('Registered ' + commands.length + ' slash commands');
    console.log('Ready! Go to Discord and type /setup');
    console.log('');
  }
}

client.on('interactionCreate', async function(interaction) {
  if (!interaction.isCommand()) return;

  var discordId = interaction.user.id;
  var username = interaction.user.username;
  var cmd = interaction.commandName;

  try {
    await interaction.deferReply();
    await getOrCreateUser(discordId, username);

    if (cmd === 'setup') await handleSetup(interaction, discordId);
    else if (cmd === 'workout') await handleWorkout(interaction, discordId);
    else if (cmd === 'log') await handleLog(interaction, discordId);
    else if (cmd === 'history') await handleHistory(interaction, discordId);
    else if (cmd === 'stats') await handleStats(interaction, discordId);
    else if (cmd === 'profile') await handleProfile(interaction, discordId);
    else if (cmd === 'streak') await handleStreak(interaction, discordId);
    else if (cmd === 'coach') await handleCoach(interaction, discordId);

  } catch (error) {
    console.error('Error in ' + cmd + ':', error.message);
    var msg = error.message || 'Something went wrong!';
    if (msg.length > 200) msg = msg.substring(0, 200);
    await interaction.editReply({ content: 'Error: ' + msg });
  }
});

async function handleSetup(interaction, discordId) {
  var level = interaction.options.getString('level');
  var goal = interaction.options.getString('goal');
  var injuries = interaction.options.getString('injuries') || 'None';

  var result = await supabase
    .from('users')
    .update({ fitness_level: level, goals: goal, injuries: injuries })
    .eq('discord_id', discordId);

  if (result.error) throw result.error;

  var embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Profile Setup Complete!')
    .addFields(
      { name: 'Fitness Level', value: level, inline: true },
      { name: 'Goal', value: goal, inline: true },
      { name: 'Injuries', value: injuries, inline: false }
    )
    .setFooter({ text: 'Use /workout to get your first personalized workout!' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleWorkout(interaction, discordId) {
  var userResult = await supabase
    .from('users')
    .select('id, fitness_level, goals, injuries')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');
  var userData = userResult.data;

  var logsResult = await supabase
    .from('rep_logs')
    .select('exercise_name, weight')
    .eq('user_id', userData.id)
    .order('logged_at', { ascending: false })
    .limit(10);

  var recentLogs = logsResult.data;
  var recentText = 'No history yet';
  if (recentLogs && recentLogs.length > 0) {
    var parts = [];
    for (var i = 0; i < recentLogs.length; i++) {
      var entry = recentLogs[i].exercise_name;
      if (recentLogs[i].weight) entry = entry + ' (' + recentLogs[i].weight + 'lbs)';
      parts.push(entry);
    }
    recentText = parts.join(', ');
  }

  var prompt = 'Create a personalized workout for this user:\n\n' +
    'Fitness Level: ' + userData.fitness_level + '\n' +
    'Goal: ' + userData.goals + '\n' +
    'Injuries: ' + userData.injuries + '\n' +
    'Recent exercises: ' + recentText + '\n\n' +
    'Create a workout for TODAY. Include 6-8 exercises.\n' +
    'Format each exercise like this (one per line):\n' +
    'Exercise Name | Sets x Reps | Weight | Notes';

  var workoutText = await askAI(prompt);

  var exercises = parseWorkout(workoutText);
  await supabase.from('workouts').insert({
    user_id: userData.id,
    workout_name: 'Workout - ' + new Date().toLocaleDateString(),
    exercises: exercises,
  });

  if (workoutText.length > 4000) {
    workoutText = workoutText.substring(0, 4000) + '...';
  }

  var embed = new EmbedBuilder()
    .setColor(0x27ae60)
    .setTitle('Your Personalized Workout')
    .setDescription(workoutText)
    .setFooter({ text: 'Log your sets with /log when done!' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleLog(interaction, discordId) {
  var userResult = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');

  var exercise = interaction.options.getString('exercise');
  var sets = interaction.options.getInteger('sets');
  var reps = interaction.options.getInteger('reps');
  var weight = interaction.options.getNumber('weight') || null;
  var notes = interaction.options.getString('notes') || '';

  await supabase.from('rep_logs').insert({
    user_id: userResult.data.id,
    exercise_name: exercise,
    sets_completed: sets,
    reps_per_set: reps,
    weight: weight,
    notes: notes,
  });

  var feedbackPrompt = 'User just logged: ' + sets + ' sets x ' + reps +
    ' reps of ' + exercise + (weight ? ' at ' + weight + 'lbs' : '') + '.' +
    (notes ? ' User notes: ' + notes : '') +
    '\n\nGive 2-3 sentences of specific, encouraging feedback.';

  var feedback = await askAI(feedbackPrompt);

  if (feedback.length > 1000) {
    feedback = feedback.substring(0, 1000) + '...';
  }

  // Calculate and update streak
  const streakResult = await calculateAndUpdateStreak(discordId, supabase);

  var embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('Workout Logged!')
    .addFields(
      { name: 'Exercise', value: exercise, inline: true },
      { name: 'Volume', value: sets + 'x' + reps + (weight ? ' @ ' + weight + 'lbs' : ''), inline: true }
    )
    .addFields({ name: 'Coach Feedback', value: feedback });

  // Add streak info if successfully updated
  if (streakResult.success && streakResult.isNewDay) {
    let streakMessage = `🔥 **Streak: ${streakResult.streak} days** ${getStreakVisual(streakResult.streak)}`;
    
    if (streakResult.unlockedBadges.length > 0) {
      streakMessage += `\n🎉 **BADGE UNLOCKED:** ${getStreakBadge(streakResult.streak)}`;
    }
    
    if (streakResult.streakReset) {
      streakMessage += '\n⚠️ Streak reset, but keep pushing!';
    }
    
    embed.addFields({
      name: '🏆 Streak Update',
      value: streakMessage,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleHistory(interaction, discordId) {
  var userResult = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');

  var logsResult = await supabase
    .from('rep_logs')
    .select('exercise_name, sets_completed, reps_per_set, weight, logged_at')
    .eq('user_id', userResult.data.id)
    .order('logged_at', { ascending: false })
    .limit(10);

  var logs = logsResult.data;

  if (!logs || logs.length === 0) {
    await interaction.editReply({ content: 'No workout logs yet! Use /log to start tracking.' });
    return;
  }

  var lines = [];
  for (var i = 0; i < logs.length; i++) {
    var line = logs[i].exercise_name + ' | ' + logs[i].sets_completed + 'x' + logs[i].reps_per_set;
    if (logs[i].weight) line = line + ' @ ' + logs[i].weight + 'lbs';
    lines.push(line);
  }

  var embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Your Last 10 Logged Exercises')
    .setDescription('```\n' + lines.join('\n') + '\n```')
    .setFooter({ text: 'Keep logging to build consistency!' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(interaction, discordId) {
  var userResult = await supabase
    .from('users')
    .select('id, created_at')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');

  var logsResult = await supabase
    .from('rep_logs')
    .select('*')
    .eq('user_id', userResult.data.id);

  var logs = logsResult.data;

  if (!logs || logs.length === 0) {
    await interaction.editReply({ content: 'No stats yet! Log workouts with /log to see your progress.' });
    return;
  }

  var totalSets = 0;
  var totalReps = 0;
  var totalVolume = 0;
  var exercises = {};
  var weightSum = 0;
  var weightCount = 0;

  for (var i = 0; i < logs.length; i++) {
    totalSets = totalSets + logs[i].sets_completed;
    totalReps = totalReps + (logs[i].sets_completed * logs[i].reps_per_set);
    totalVolume = totalVolume + (logs[i].sets_completed * logs[i].reps_per_set * (logs[i].weight || 0));
    exercises[logs[i].exercise_name] = true;
    if (logs[i].weight) {
      weightSum = weightSum + logs[i].weight;
      weightCount = weightCount + 1;
    }
  }

  var uniqueCount = Object.keys(exercises).length;
  var avgWeight = weightCount > 0 ? (weightSum / weightCount).toFixed(1) : '0';

  var embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('Your Fitness Statistics')
    .addFields(
      { name: 'Total Sets', value: String(totalSets), inline: true },
      { name: 'Total Reps', value: String(totalReps), inline: true },
      { name: 'Total Volume', value: Math.round(totalVolume) + ' lbs', inline: true },
      { name: 'Unique Exercises', value: String(uniqueCount), inline: true },
      { name: 'Avg Weight', value: avgWeight + ' lbs', inline: true },
      { name: 'Member Since', value: new Date(userResult.data.created_at).toLocaleDateString(), inline: true }
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleProfile(interaction, discordId) {
  var userResult = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');
  var userData = userResult.data;

  var embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(userData.username + ' - Fitness Profile')
    .addFields(
      { name: 'Fitness Level', value: userData.fitness_level || 'Not set', inline: true },
      { name: 'Goal', value: userData.goals || 'Not set', inline: true },
      { name: 'Injuries', value: userData.injuries || 'None', inline: false }
    )
    .setFooter({ text: 'Use /setup to update your profile' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleStreak(interaction, discordId) {
  const userResult = await supabase
    .from('users')
    .select('current_streak, longest_streak, streak_milestones')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error || !userResult.data) {
    return interaction.editReply({
      content: '❌ No streak data found. Start logging workouts with /log to build a streak!',
    });
  }

  const userData = userResult.data;

  const embed = new EmbedBuilder()
    .setColor('#FF6B6B')
    .setTitle('🔥 Your Workout Streak')
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      {
        name: '🏃 Current Streak',
        value: `${userData.current_streak} ${userData.current_streak === 1 ? 'day' : 'days'} ${getStreakVisual(userData.current_streak)}`,
        inline: true,
      },
      {
        name: '🏆 Longest Streak',
        value: `${userData.longest_streak} days`,
        inline: true,
      }
    );

  // Add milestone badges
  const milestones = userData.streak_milestones || {};
  let badgeList = '';
  const milestoneDays = [7, 14, 30, 60, 100];

  for (const day of milestoneDays) {
    const badge = getStreakBadge(day);
    if (badge) {
      badgeList += milestones[day] ? `✅ ${badge} (${day}d)\n` : `⬜ ${badge} (${day}d)\n`;
    }
  }

  if (badgeList) {
    embed.addFields({
      name: '🎖️ Milestone Badges',
      value: badgeList,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleCoach(interaction, discordId) {
  var question = interaction.options.getString('question');

  var userResult = await supabase
    .from('users')
    .select('fitness_level, goals, injuries')
    .eq('discord_id', discordId)
    .single();

  var context = '';
  if (userResult.data) {
    context = '\n\nUser Profile: Level=' + userResult.data.fitness_level +
      ', Goal=' + userResult.data.goals +
      ', Injuries=' + userResult.data.injuries;
  }

  var answer = await askAI(question + context);

  if (answer.length > 4000) {
    answer = answer.substring(0, 4000) + '...';
  }

  var embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('Coach Says:')
    .setDescription(answer);

  await interaction.editReply({ embeds: [embed] });
}

async function getOrCreateUser(discordId, username) {
  var result = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .single();

  if (result.data) return result.data;

  var insertResult = await supabase
    .from('users')
    .insert({ discord_id: discordId, username: username })
    .select()
    .single();

  if (insertResult.error) throw insertResult.error;
  console.log('New user created: ' + username);
  return insertResult.data;
}

function parseWorkout(text) {
  var lines = text.split('\n');
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('|') !== -1) {
      var parts = lines[i].split('|');
      result.push({
        name: parts[0] ? parts[0].trim() : '',
        setsReps: parts[1] ? parts[1].trim() : '',
        weight: parts[2] ? parts[2].trim() : '',
        notes: parts[3] ? parts[3].trim() : '',
      });
    }
  }
  return result;
}

client.login(process.env.DISCORD_TOKEN);
console.log('Starting AI Fitness Coach Bot...');

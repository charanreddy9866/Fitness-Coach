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

// Common foods database (can be expanded)
const FOOD_DATABASE = {
  'chicken breast': { calories: 165, protein: 31, carbs: 0, fats: 3.6, serving: '100g' },
  'brown rice': { calories: 111, protein: 2.6, carbs: 23, fats: 0.9, serving: '100g' },
  'broccoli': { calories: 34, protein: 2.8, carbs: 7, fats: 0.4, serving: '100g' },
  'salmon': { calories: 208, protein: 20, carbs: 0, fats: 13, serving: '100g' },
  'egg': { calories: 155, protein: 13, carbs: 1.1, fats: 11, serving: '1 large' },
  'oats': { calories: 389, protein: 17, carbs: 66, fats: 6.9, serving: '100g' },
  'banana': { calories: 89, protein: 1.1, carbs: 23, fats: 0.3, serving: '1 medium' },
  'almonds': { calories: 579, protein: 21, carbs: 22, fats: 50, serving: '100g' },
  'greek yogurt': { calories: 59, protein: 10, carbs: 3.3, fats: 0.4, serving: '100g' },
  'sweet potato': { calories: 86, protein: 1.6, carbs: 20, fats: 0.1, serving: '100g' },
  'ground beef': { calories: 250, protein: 26, carbs: 0, fats: 17, serving: '100g' },
  'white rice': { calories: 130, protein: 2.7, carbs: 28, fats: 0.3, serving: '100g' },
};

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
    const today = new Date().toISOString().split('T')[0];
    const lastWorkoutDate = userData.last_workout_date;
    let newStreak = userData.current_streak || 0;
    let longestStreak = userData.longest_streak || 0;
    let streakReset = false;

    if (!lastWorkoutDate) {
      newStreak = 1;
    } else {
      const lastDate = new Date(lastWorkoutDate);
      const todayDate = new Date(today);
      const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        newStreak += 1;
      } else if (daysDiff === 0) {
        return { success: true, streak: newStreak, isNewDay: false };
      } else {
        newStreak = 1;
        streakReset = true;
      }
    }

    if (newStreak > longestStreak) {
      longestStreak = newStreak;
    }

    const milestones = userData.streak_milestones || {};
    const milestoneDays = [7, 14, 30, 60, 100];
    let unlockedBadges = [];

    for (const day of milestoneDays) {
      if (newStreak >= day && !milestones[day]) {
        milestones[day] = true;
        unlockedBadges.push(day);
      }
    }

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
  const fireEmojis = Math.min(Math.ceil(streakDays / 10), 10);
  return '🔥'.repeat(fireEmojis);
}

// ===== END STREAK UTILITIES =====

// ===== WEEKLY PROGRESS UTILITIES =====
async function getWeeklyStats(userId, supabase) {
  try {
    const today = new Date();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisWeekStartStr = thisWeekStart.toISOString().split('T')[0];

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekStartStr = lastWeekStart.toISOString().split('T')[0];

    const lastWeekEndStr = thisWeekStart.toISOString().split('T')[0];

    const thisWeekResult = await supabase
      .from('rep_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('logged_at', thisWeekStartStr);

    const lastWeekResult = await supabase
      .from('rep_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('logged_at', lastWeekStartStr)
      .lt('logged_at', lastWeekEndStr);

    const thisWeekLogs = thisWeekResult.data || [];
    const lastWeekLogs = lastWeekResult.data || [];

    const thisWeekStats = calculateStats(thisWeekLogs);
    const lastWeekStats = calculateStats(lastWeekLogs);

    const volumeChange = thisWeekStats.totalVolume - lastWeekStats.totalVolume;
    const volumePercent = lastWeekStats.totalVolume > 0 
      ? Math.round((volumeChange / lastWeekStats.totalVolume) * 100)
      : 0;
    const workoutDiff = thisWeekStats.workoutCount - lastWeekStats.workoutCount;

    return {
      thisWeek: thisWeekStats,
      lastWeek: lastWeekStats,
      volumeChange: volumeChange,
      volumePercent: volumePercent,
      workoutDiff: workoutDiff,
    };
  } catch (error) {
    console.error('Error calculating weekly stats:', error);
    return null;
  }
}

function calculateStats(logs) {
  if (!logs || logs.length === 0) {
    return {
      workoutCount: 0,
      totalVolume: 0,
      totalSets: 0,
      totalReps: 0,
      uniqueExercises: 0,
      topExercises: [],
    };
  }

  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;
  let exerciseMap = {};

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    totalSets += log.sets_completed;
    totalReps += log.sets_completed * log.reps_per_set;
    totalVolume += log.sets_completed * log.reps_per_set * (log.weight || 0);

    if (!exerciseMap[log.exercise_name]) {
      exerciseMap[log.exercise_name] = 0;
    }
    exerciseMap[log.exercise_name] += log.sets_completed * log.reps_per_set * (log.weight || 0);
  }

  const topExercises = Object.entries(exerciseMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, volume]) => ({ name, volume: Math.round(volume) }));

  const uniqueCount = Object.keys(exerciseMap).length;
  const workoutDays = new Set(logs.map(log => log.logged_at.split('T')[0])).size;

  return {
    workoutCount: workoutDays,
    totalVolume: Math.round(totalVolume),
    totalSets: totalSets,
    totalReps: totalReps,
    uniqueExercises: uniqueCount,
    topExercises: topExercises,
  };
}

// ===== END WEEKLY PROGRESS UTILITIES =====

// ===== NUTRITION UTILITIES =====
async function getNutritionStats(userId, supabase, days = 1) {
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    const startDateStr = startDate.toISOString().split('T')[0];

    const result = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('meal_date', startDateStr);

    const meals = result.data || [];

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;
    let mealCount = 0;

    for (let i = 0; i < meals.length; i++) {
      const meal = meals[i];
      totalCalories += meal.calories || 0;
      totalProtein += meal.protein || 0;
      totalCarbs += meal.carbs || 0;
      totalFats += meal.fats || 0;
      mealCount++;
    }

    return {
      calories: Math.round(totalCalories),
      protein: Math.round(totalProtein),
      carbs: Math.round(totalCarbs),
      fats: Math.round(totalFats),
      mealCount: mealCount,
    };
  } catch (error) {
    console.error('Error calculating nutrition stats:', error);
    return null;
  }
}

function getFoodNutrition(foodName, quantity = 1) {
  const food = FOOD_DATABASE[foodName.toLowerCase()];
  if (!food) return null;

  return {
    name: foodName,
    calories: Math.round(food.calories * quantity),
    protein: Math.round(food.protein * quantity * 10) / 10,
    carbs: Math.round(food.carbs * quantity * 10) / 10,
    fats: Math.round(food.fats * quantity * 10) / 10,
    serving: food.serving,
  };
}

function searchFoods(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const [foodName, nutrition] of Object.entries(FOOD_DATABASE)) {
    if (foodName.includes(lowerQuery)) {
      results.push(foodName);
    }
  }

  return results.slice(0, 5);
}

// ===== END NUTRITION UTILITIES =====

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
      .setName('streak')
      .setDescription('View your workout streak and milestone badges'),

    new SlashCommandBuilder()
      .setName('weekly')
      .setDescription('View your weekly progress report'),

    new SlashCommandBuilder()
      .setName('meal')
      .setDescription('Log a meal with macros')
      .addStringOption(function(option) {
        return option.setName('food').setDescription('Food name (e.g., chicken breast, brown rice)').setRequired(true);
      })
      .addNumberOption(function(option) {
        return option.setName('quantity').setDescription('Quantity (servings, default: 1)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('calories').setDescription('Calories (optional, override)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('protein').setDescription('Protein in grams (optional, override)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('carbs').setDescription('Carbs in grams (optional, override)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('fats').setDescription('Fats in grams (optional, override)').setRequired(false);
      }),

    new SlashCommandBuilder()
      .setName('nutrition')
      .setDescription('View your daily nutrition summary'),

    new SlashCommandBuilder()
      .setName('macros')
      .setDescription('View or set your daily macro goals')
      .addStringOption(function(option) {
        return option.setName('action').setDescription('View or set goals').setRequired(true)
          .addChoices(
            { name: 'View', value: 'view' },
            { name: 'Set', value: 'set' }
          );
      })
      .addIntegerOption(function(option) {
        return option.setName('protein').setDescription('Daily protein goal in grams (for set)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('carbs').setDescription('Daily carbs goal in grams (for set)').setRequired(false);
      })
      .addIntegerOption(function(option) {
        return option.setName('fats').setDescription('Daily fats goal in grams (for set)').setRequired(false);
      }),

    new SlashCommandBuilder()
      .setName('foods')
      .setDescription('Search food database')
      .addStringOption(function(option) {
        return option.setName('query').setDescription('Food to search (e.g., chicken, rice)').setRequired(true);
      }),

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
    else if (cmd === 'weekly') await handleWeekly(interaction, discordId);
    else if (cmd === 'meal') await handleMeal(interaction, discordId);
    else if (cmd === 'nutrition') await handleNutrition(interaction, discordId);
    else if (cmd === 'macros') await handleMacros(interaction, discordId);
    else if (cmd === 'foods') await handleFoods(interaction, discordId);
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

  const streakResult = await calculateAndUpdateStreak(discordId, supabase);

  var embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('Workout Logged!')
    .addFields(
      { name: 'Exercise', value: exercise, inline: true },
      { name: 'Volume', value: sets + 'x' + reps + (weight ? ' @ ' + weight + 'lbs' : ''), inline: true }
    )
    .addFields({ name: 'Coach Feedback', value: feedback });

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

async function handleWeekly(interaction, discordId) {
  const userResult = await supabase
    .from('users')
    .select('id, current_streak')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error || !userResult.data) {
    return interaction.editReply({
      content: '❌ User not found. Run /setup first!',
    });
  }

  const userId = userResult.data.id;
  const currentStreak = userResult.data.current_streak || 0;

  const weeklyData = await getWeeklyStats(userId, supabase);

  if (!weeklyData) {
    return interaction.editReply({
      content: '❌ Error loading weekly stats. Try again later.',
    });
  }

  const thisWeek = weeklyData.thisWeek;

  if (thisWeek.workoutCount === 0) {
    return interaction.editReply({
      content: '📊 No workouts logged this week yet. Start with /log to begin tracking!',
    });
  }

  let topExercisesText = '';
  if (thisWeek.topExercises.length > 0) {
    for (let i = 0; i < thisWeek.topExercises.length; i++) {
      const ex = thisWeek.topExercises[i];
      topExercisesText += `${i + 1}. ${ex.name} (${ex.volume} lbs)\n`;
    }
  }

  let progressText = `📈 Workouts: ${weeklyData.workoutDiff > 0 ? '+' : ''}${weeklyData.workoutDiff}`;
  if (weeklyData.volumeChange !== 0) {
    progressText += `\n📊 Volume: ${weeklyData.volumeChange > 0 ? '+' : ''}${weeklyData.volumeChange} lbs (${weeklyData.volumePercent > 0 ? '+' : ''}${weeklyData.volumePercent}%)`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📊 Weekly Progress Report')
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      {
        name: '💪 This Week',
        value: `Workouts: ${thisWeek.workoutCount}\nVolume: ${thisWeek.totalVolume} lbs\nUnique Exercises: ${thisWeek.uniqueExercises}\nCurrent Streak: ${currentStreak} days 🔥`,
      },
      {
        name: '📈 vs Last Week',
        value: progressText || 'No data to compare',
      }
    );

  if (topExercisesText) {
    embed.addFields({
      name: '🏋️ Top Exercises',
      value: topExercisesText,
    });
  }

  embed.setFooter({ text: 'Keep crushing it! Share your progress.' });

  return interaction.editReply({ embeds: [embed] });
}

async function handleMeal(interaction, discordId) {
  const userResult = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');

  const food = interaction.options.getString('food');
  const quantity = interaction.options.getNumber('quantity') || 1;
  const overrideCalories = interaction.options.getInteger('calories');
  const overrideProtein = interaction.options.getInteger('protein');
  const overrideCarbs = interaction.options.getInteger('carbs');
  const overrideFats = interaction.options.getInteger('fats');

  let mealData;

  if (overrideCalories !== null) {
    mealData = {
      calories: overrideCalories,
      protein: overrideProtein || 0,
      carbs: overrideCarbs || 0,
      fats: overrideFats || 0,
    };
  } else {
    mealData = getFoodNutrition(food, quantity);
    if (!mealData) {
      return interaction.editReply({
        content: `❌ Food "${food}" not found. Try /foods to search the database.`,
      });
    }
  }

  const today = new Date().toISOString().split('T')[0];

  await supabase.from('meals').insert({
    user_id: userResult.data.id,
    food_name: food,
    meal_date: today,
    calories: mealData.calories,
    protein: mealData.protein,
    carbs: mealData.carbs,
    fats: mealData.fats,
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🍽️ Meal Logged!')
    .addFields(
      { name: 'Food', value: food, inline: true },
      { name: 'Quantity', value: String(quantity), inline: true },
      { name: 'Calories', value: mealData.calories + ' kcal', inline: true },
      { name: 'Protein', value: mealData.protein + 'g', inline: true },
      { name: 'Carbs', value: mealData.carbs + 'g', inline: true },
      { name: 'Fats', value: mealData.fats + 'g', inline: true }
    )
    .setFooter({ text: 'Use /nutrition to see your daily totals' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleNutrition(interaction, discordId) {
  const userResult = await supabase
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .single();

  if (userResult.error) throw new Error('User not found. Run /setup first!');

  const stats = await getNutritionStats(userResult.data.id, supabase, 1);

  if (!stats || stats.mealCount === 0) {
    return interaction.editReply({
      content: '🍽️ No meals logged today yet. Use /meal to start tracking!',
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🥗 Today\'s Nutrition')
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Calories', value: stats.calories + ' kcal', inline: true },
      { name: 'Protein', value: stats.protein + 'g', inline: true },
      { name: 'Carbs', value: stats.carbs + 'g', inline: true },
      { name: 'Fats', value: stats.fats + 'g', inline: true },
      { name: 'Meals Logged', value: String(stats.mealCount), inline: true }
    )
    .setFooter({ text: 'Use /macros set to set your daily goals' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleMacros(interaction, discordId) {
  const action = interaction.options.getString('action');

  if (action === 'view') {
    const userResult = await supabase
      .from('users')
      .select('daily_protein_goal, daily_carbs_goal, daily_fats_goal')
      .eq('discord_id', discordId)
      .single();

    if (userResult.error || !userResult.data.daily_protein_goal) {
      return interaction.editReply({
        content: '❌ No macro goals set. Use `/macros set` to configure your goals.',
      });
    }

    const stats = await getNutritionStats((await supabase.from('users').select('id').eq('discord_id', discordId).single()).data.id, supabase, 1);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🎯 Your Macro Goals')
      .addFields(
        { name: 'Protein', value: `${stats.protein}g / ${userResult.data.daily_protein_goal}g`, inline: true },
        { name: 'Carbs', value: `${stats.carbs}g / ${userResult.data.daily_carbs_goal}g`, inline: true },
        { name: 'Fats', value: `${stats.fats}g / ${userResult.data.daily_fats_goal}g`, inline: true }
      );

    return interaction.editReply({ embeds: [embed] });
  } else {
    const protein = interaction.options.getInteger('protein');
    const carbs = interaction.options.getInteger('carbs');
    const fats = interaction.options.getInteger('fats');

    if (!protein || !carbs || !fats) {
      return interaction.editReply({
        content: '❌ Please provide protein, carbs, and fats goals.',
      });
    }

    await supabase
      .from('users')
      .update({
        daily_protein_goal: protein,
        daily_carbs_goal: carbs,
        daily_fats_goal: fats,
      })
      .eq('discord_id', discordId);

    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle('✅ Macro Goals Set!')
      .addFields(
        { name: 'Daily Protein', value: protein + 'g', inline: true },
        { name: 'Daily Carbs', value: carbs + 'g', inline: true },
        { name: 'Daily Fats', value: fats + 'g', inline: true }
      );

    return interaction.editReply({ embeds: [embed] });
  }
}

async function handleFoods(interaction, discordId) {
  const query = interaction.options.getString('query');
  const results = searchFoods(query);

  if (results.length === 0) {
    return interaction.editReply({
      content: `❌ No foods found matching "${query}". Try another search!`,
    });
  }

  let foodList = '';
  for (let i = 0; i < results.length; i++) {
    const food = FOOD_DATABASE[results[i]];
    foodList += `**${results[i]}** - ${food.calories} cal | P: ${food.protein}g C: ${food.carbs}g F: ${food.fats}g (per ${food.serving})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('🔍 Food Search Results')
    .setDescription(foodList)
    .setFooter({ text: 'Use /meal to log any of these foods' });

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

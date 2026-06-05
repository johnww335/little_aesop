-- ============================================================
-- Little Aesop — Phase 2 Migration
-- Seeds the question_bank table with 100 child-friendly prompts
-- Run this in your Supabase SQL editor AFTER migration_phase1.sql
-- ============================================================

insert into public.question_bank (prompt_text) values
  -- Animals & Nature
  ('Choose an animal'),
  ('What is your favourite wild animal?'),
  ('If you could be any animal, what would you be?'),
  ('Name a baby animal'),
  ('What animal makes the funniest noise?'),
  ('Choose an animal that lives in the ocean'),
  ('What animal would be the silliest pet?'),
  ('Name a very tiny animal'),
  ('Name a very big animal'),
  ('What animal is the fluffiest?'),

  -- Food & Drink
  ('What is your favourite food?'),
  ('What is your least favourite food?'),
  ('What is the yummiest dessert?'),
  ('Name a food that is a funny colour'),
  ('What is the most delicious breakfast?'),
  ('Name a fruit you love'),
  ('What is the silliest snack?'),
  ('Name something you love to eat for dinner'),
  ('What is the crunchiest food?'),
  ('Name a food that is round'),

  -- Colours & Shapes
  ('Choose a colour'),
  ('What is your favourite colour?'),
  ('What colour makes you happy?'),
  ('Choose a very bright colour'),
  ('Name a colour you see in the sky'),

  -- Objects & Things
  ('Choose a musical instrument'),
  ('What is your favourite toy?'),
  ('Name something you find in a kitchen'),
  ('What would you pack in a magic backpack?'),
  ('Choose a type of vehicle'),
  ('What is your favourite thing to wear?'),
  ('Name something that is very tall'),
  ('Name something that is very small'),
  ('What is the shiniest thing you can think of?'),
  ('Name something you find at a beach'),

  -- Places
  ('Where would you most like to go on an adventure?'),
  ('Name a magical place'),
  ('What is the most exciting place in the world?'),
  ('Where would you hide a treasure?'),
  ('Name a place that has lots of animals'),

  -- Weather & Seasons
  ('Choose a season'),
  ('What is your favourite type of weather?'),
  ('What do you love to do when it snows?'),
  ('What is the best thing about summer?'),
  ('Name something that only happens in autumn'),

  -- Feelings & Imagination
  ('What superpower would you most want?'),
  ('If you had a magic wand, what would you create?'),
  ('What would your dream treehouse look like?'),
  ('What is your favourite type of adventure?'),
  ('If you could fly anywhere, where would you go?'),

  -- People & Characters
  ('Choose a hairstyle'),
  ('What would you name a friendly dragon?'),
  ('What would a talking cat say?'),
  ('What would a giant be afraid of?'),
  ('Name a job that sounds really fun'),

  -- Numbers & Sizes
  ('Pick a lucky number'),
  ('How many windows would your dream house have?'),
  ('Name something that comes in threes'),
  ('How tall (in elephants) would a giant be?'),
  ('How many scoops of ice cream is the perfect amount?'),

  -- Transport & Travel
  ('What type of car do you like?'),
  ('Choose a way to travel through the sky'),
  ('What would your dream boat look like?'),
  ('If you had a rocket ship, where would you go?'),
  ('Name the fastest way to travel'),

  -- Actions & Hobbies
  ('What is your favourite sport?'),
  ('What do you love to do on weekends?'),
  ('Name something fun to do at a park'),
  ('What is the best dance move?'),
  ('What is the most exciting game to play?'),

  -- Silly & Funny
  ('Name something that is really wiggly'),
  ('What is the funniest word you know?'),
  ('What would a sneezing elephant sound like?'),
  ('Name something that bounces'),
  ('What would you name a silly monster?'),

  -- Magical & Fantasy
  ('Name a magical creature'),
  ('What colour would a friendly wizard wear?'),
  ('What would a fairy collect?'),
  ('If you found a treasure chest, what would be inside?'),
  ('What would a magical forest smell like?'),

  -- School & Learning
  ('What is your favourite subject at school?'),
  ('Name something you can learn to do'),
  ('What would you teach a robot?'),
  ('What is the most interesting thing you have ever learned?'),
  ('Name a book you love'),

  -- Home & Family
  ('Name your favourite room in a house'),
  ('What is the cosiest thing you can think of?'),
  ('What would your dream bedroom have in it?'),
  ('Name something that always makes you feel safe'),
  ('What is the best smell in a home?'),

  -- Stars & Space
  ('Name a planet'),
  ('What would you find on the moon?'),
  ('If you were an astronaut, what would you bring?'),
  ('What colour is your favourite star?'),
  ('Name something mysterious about space'),

  -- Extras
  ('What is your favourite sound?'),
  ('Name something that glows'),
  ('What would a friendly cloud be named?'),
  ('Name something that is stripy'),
  ('What would you put in a time capsule?');

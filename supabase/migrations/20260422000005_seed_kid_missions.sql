-- BudgetWise Junior — seed all 12 missions (Phase 3 kickoff).
-- Upsert so re-runs refresh content. Keeps slug as the primary dedup key.

insert into kid_missions (slug, unit, title, ord, body) values
  ('what-is-saving', 'Saving', 'What does it mean to save?', 1, $BODY$
  {"steps":[
    {"type":"hook","title":"Zoë's R100","body":"Zoë got R100 from her gran. Watch what happens when she spends it all on sweets vs splits it into jars."},
    {"type":"concept","title":"A jar that waits grows","body":"A jar that waits grows. A jar that rushes empties."},
    {"type":"quiz","question":"Which jar gets bigger over time?","options":["The Save jar","The Spend jar","The Give jar"],"answer":0},
    {"type":"tie_in","body":"If you saved half of what you earn this week, your goal would be closer."},
    {"type":"done","body":"Mission done! Your first lesson is complete."}
  ]}
  $BODY$::jsonb),
  ('effort-vs-time', 'Earning', 'Why some jobs pay more', 2, $BODY$
  {"steps":[
    {"type":"hook","title":"A dentist vs a babysitter","body":"A dentist earns about R500 an hour. A babysitter earns about R60 an hour. Why?"},
    {"type":"concept","title":"Harder, riskier, rarer = more money","body":"Jobs that need years of school, or only a few people can do, or are risky, usually pay more per hour. It's not that one person 'deserves' more — it's that fewer people can do it."},
    {"type":"quiz","question":"Which of these probably earns the most per hour?","options":["A pilot","A dog-walker","A cashier"],"answer":0},
    {"type":"tie_in","body":"The skills you build as a kid (like learning to save money) are tools you'll use later to earn more per hour."},
    {"type":"done","body":"Got it. Knowing WHY things pay different amounts helps you pick what to learn."}
  ]}
  $BODY$::jsonb),
  ('one-rand-one-minute', 'Earning', 'Your time has a price', 3, $BODY$
  {"steps":[
    {"type":"hook","title":"How much is an hour of YOU?","body":"If I paid you R10 to wash the dishes for 15 minutes, that's R40 per hour. What would you charge for an hour of your time?"},
    {"type":"concept","title":"Time is money","body":"When you do a chore for a reward, you're selling your time. The fair price depends on how hard, long, and skilled the work is."},
    {"type":"quiz","question":"Wash 10 cars for R50 in 2 hours. What's your rate per hour?","options":["R5","R25","R250"],"answer":1},
    {"type":"tie_in","body":"Next time your parent offers you a chore, decide: is the reward worth the time?"},
    {"type":"done","body":"You now think like a worker AND a boss."}
  ]}
  $BODY$::jsonb),
  ('tried-failed-learned', 'Earning', 'Paid to learn', 4, $BODY$
  {"steps":[
    {"type":"hook","title":"When getting it wrong is the lesson","body":"Sarah tried to sell lemonade for R50 a glass. Nobody bought any. She dropped the price to R10. All 20 glasses sold."},
    {"type":"concept","title":"Trying and failing teaches you more than not trying","body":"The people who earn the most money are usually the ones who failed the most times and kept going."},
    {"type":"quiz","question":"Sarah's lemonade failure taught her…","options":["To give up","The right price","Lemonade is bad"],"answer":1},
    {"type":"tie_in","body":"Even finishing this quiz and getting it wrong means you learned. That's worth real money over time."},
    {"type":"done","body":"Failing fast is earning, slowly."}
  ]}
  $BODY$::jsonb),
  ('compound-starter', 'Saving', 'Your money can grow by itself', 5, $BODY$
  {"steps":[
    {"type":"hook","title":"R10 today, R10.50 tomorrow","body":"If you put R10 in a jar that grows 5% each year, after 1 year you have R10.50. No extra work — the jar gave you the 50c."},
    {"type":"concept","title":"Interest — money earning money","body":"Banks pay you for leaving your money with them. It's small at first, but over many years the growth stacks on itself. This is called compound interest."},
    {"type":"quiz","question":"If R100 grows by 10% each year, how much after 2 years?","options":["R110","R121","R120"],"answer":1},
    {"type":"tie_in","body":"Starting young matters. R100 now could become R1,000+ by the time you're an adult."},
    {"type":"done","body":"Money that sleeps in a jar can still work for you."}
  ]}
  $BODY$::jsonb),
  ('rainy-day', 'Saving', 'The rainy-day jar', 6, $BODY$
  {"steps":[
    {"type":"hook","title":"What if your phone breaks?","body":"Thandi's phone screen cracked. Fixing it was R400. Because she'd been saving R20 a week for 5 months, she had R400 in her rainy-day jar."},
    {"type":"concept","title":"Emergency money stops small problems from becoming big ones","body":"Grownups call this an emergency fund. Having even a small one means you don't have to borrow or panic when something breaks."},
    {"type":"quiz","question":"What's a rainy-day jar for?","options":["Candy","Unexpected problems","Christmas gifts"],"answer":1},
    {"type":"tie_in","body":"Try to keep at least R50 in your Save jar that you promise yourself not to touch — that's your rainy day."},
    {"type":"done","body":"Rainy days come. You don't have to be caught in them."}
  ]}
  $BODY$::jsonb),
  ('needs-vs-wants', 'Spending', 'Is it air or candy?', 7, $BODY$
  {"steps":[
    {"type":"hook","title":"Two shopping lists","body":"Ama and Jabu each got R100. Ama spent all of hers on sweets. Jabu spent R50 on a book and R50 on sweets. A week later, Ama has 0. Jabu has a book."},
    {"type":"concept","title":"Needs keep you alive. Wants make you smile.","body":"Food, shelter, school supplies — those are needs. Candy, games, shoes you don't need — those are wants. Both are OK! The trick is knowing which is which."},
    {"type":"quiz","question":"Which of these is a NEED?","options":["New sneakers when yours still fit","Food for dinner","A second gaming console"],"answer":1},
    {"type":"tie_in","body":"Next time you want to buy something, ask: is this air (I'll die without it) or candy (I'd like it)? Both are fine; just know which."},
    {"type":"done","body":"Knowing needs vs wants is a superpower."}
  ]}
  $BODY$::jsonb),
  ('is-it-worth-it', 'Spending', 'The 3-question test', 8, $BODY$
  {"steps":[
    {"type":"hook","title":"Before you swipe","body":"Kgomotso was about to buy a R200 toy. Then she asked herself three questions. She put the toy back."},
    {"type":"concept","title":"The three questions","body":"Before any purchase, ask: (1) Will I still want this in a week? (2) Can I get it cheaper somewhere else? (3) Do I already have something like this?"},
    {"type":"quiz","question":"Which question helps the most?","options":["Will I still want it in a week?","Is it on sale?","Is it shiny?"],"answer":0},
    {"type":"tie_in","body":"Try it on the next thing you want. If 2 out of 3 answers say 'no' — skip it this time."},
    {"type":"done","body":"You now have a tool grownups wish they had."}
  ]}
  $BODY$::jsonb),
  ('buyer-remorse', 'Spending', 'The R50 candy lesson', 9, $BODY$
  {"steps":[
    {"type":"hook","title":"Zoë's sad Wednesday","body":"Zoë spent her whole week's allowance on R50 of sweets on Monday. By Wednesday, the sweets were gone. On Thursday she saw a book she really wanted — but had no money."},
    {"type":"concept","title":"Buyer's remorse","body":"The bad feeling AFTER you buy something is called buyer's remorse. It usually hits when you spent money you wish you had for something else."},
    {"type":"quiz","question":"What could Zoë have done to avoid this?","options":["Not save","Spread her money across the week","Ask for more allowance"],"answer":1},
    {"type":"tie_in","body":"Keep a small record of things you buy and don't need. Next time the urge hits, remember how the last one felt."},
    {"type":"done","body":"The best purchase is the one you're still happy about next week."}
  ]}
  $BODY$::jsonb),
  ('why-give', 'Giving', 'Giving is not losing', 10, $BODY$
  {"steps":[
    {"type":"hook","title":"R10 that changed a week","body":"Lethabo gave R10 to a kid on her street who hadn't eaten that day. The kid smiled for the first time all week. Lethabo still had R190 in her Save jar."},
    {"type":"concept","title":"Giving makes you richer, not poorer","body":"Research says people who give regularly feel happier, have better friendships, and actually save more money too. Giving isn't about having less — it's about building a world you want to live in."},
    {"type":"quiz","question":"Why do people who give often ALSO save more?","options":["It's a coincidence","They think about money more clearly","They feel guilty"],"answer":1},
    {"type":"tie_in","body":"Your Give jar doesn't have to be big. Even R2 a week to one cause adds up and trains the habit."},
    {"type":"done","body":"Giving is the secret third winner."}
  ]}
  $BODY$::jsonb),
  ('pick-a-cause', 'Giving', 'Where should your Give jar go?', 11, $BODY$
  {"steps":[
    {"type":"hook","title":"Three families, three causes","body":"The Naidoos give to animal shelters. The Bhayats feed street dogs. The Marais family gives to their school's extra-meals program. All are right."},
    {"type":"concept","title":"Give to something YOU care about","body":"You'll give more, and keep giving, if you believe in the cause. Animals, food, kids, environment, faith — whatever makes you feel 'this matters'."},
    {"type":"quiz","question":"What's the best cause?","options":["The biggest one","The one YOU believe in","The one nobody else supports"],"answer":1},
    {"type":"tie_in","body":"Write down one cause you care about. Next time you settle up, imagine your Give jar going there."},
    {"type":"done","body":"Your cause, your call."}
  ]}
  $BODY$::jsonb),
  ('small-gifts-big-impact', 'Giving', 'R1 to the right place', 12, $BODY$
  {"steps":[
    {"type":"hook","title":"One rand, 3,000 people","body":"If everyone in your school gave R1 to a food charity once, that's about R3,000. Enough to feed 300 hungry kids for a day."},
    {"type":"concept","title":"Small on their own, huge together","body":"You don't have to be rich to matter. Small regular gifts from many people change more than one big gift from one rich person."},
    {"type":"quiz","question":"Which impacts more?","options":["1 person gives R1,000 once","1,000 people give R1 each month","Neither"],"answer":1},
    {"type":"tie_in","body":"When you settle up, even R2 in the Give jar is part of something bigger."},
    {"type":"done","body":"Small + steady = enormous."}
  ]}
  $BODY$::jsonb)
on conflict (slug) do update set
  unit = excluded.unit,
  title = excluded.title,
  ord = excluded.ord,
  body = excluded.body;

-- Junior Phase 6 — bracket 10-12 missions: "Earning and choosing"
-- 5 original missions. SA context: Pick n Pay, Shoprite, SARS.

insert into kid_missions (slug, unit, title, ord, age_min, age_max, body) values
  ('opportunity-cost', 'Earning and choosing', 'Every rand is a choice', 18, 10, 12, $BODY$
  {"steps":[
    {"type":"hook","title":"The R50 decision","body":"You have R50. You can buy a movie ticket OR a data voucher. You can''t have both. Which do you pick?"},
    {"type":"concept","title":"The thing you don''t buy","body":"Economists call this ''opportunity cost'' — the thing you give up when you choose something else. Every rand spent is a rand NOT spent elsewhere. Even doing nothing has a cost: that money could have been earning interest. You''re always trading."},
    {"type":"quiz","question":"You spend R100 on clothes instead of saving for a bike. What''s the opportunity cost?","options":["The R100","The bike you didn''t get closer to","Nothing, shopping is great"],"answer":1},
    {"type":"tie_in","body":"Before your next big buy, ask: what am I NOT doing with this money? If the answer is ''something I want more,'' put the money back."},
    {"type":"done","body":"You see money in 3D now. Every choice closes a door."}
  ]}
  $BODY$::jsonb),

  ('prices-differ', 'Earning and choosing', 'Why prices differ', 19, 10, 12, $BODY$
  {"steps":[
    {"type":"hook","title":"Same bread, two prices","body":"Same loaf of bread. Pick n Pay sells it for R15, Shoprite for R12. Why the R3 gap?"},
    {"type":"concept","title":"Prices reflect shops, not just things","body":"Prices aren''t fixed by the product. Shops pay different rents, buy in different volumes, and target different customers. Some shops sell speed and convenience; others sell lower prices. Both are fine — but you''re deciding which one you''re paying for every time."},
    {"type":"quiz","question":"A shop charges R20 for what another shop charges R15 for. The most likely reason:","options":["Fancy shop with air-con and music","They don''t like you","They''re lying about the product"],"answer":0},
    {"type":"tie_in","body":"Glance at one other shop''s price before you buy. Small comparisons save big money over months."},
    {"type":"done","body":"You''re not just a buyer. You''re a shopper."}
  ]}
  $BODY$::jsonb),

  ('what-is-budget', 'Earning and choosing', 'What''s a budget?', 20, 10, 12, $BODY$
  {"steps":[
    {"type":"hook","title":"R200 allowance, R300 game","body":"You get R200 a month. You want a R300 game. How do you get it?"},
    {"type":"concept","title":"A plan BEFORE the money arrives","body":"A budget is a plan for your money before it comes in. Income = R200. You decide: Save R100 (for the game), Spend R80, Give R20. In 3 months you have R300. No budget = money disappears and you wonder where."},
    {"type":"quiz","question":"What does a budget actually do?","options":["Stops you spending anything","Plans where your money goes so you get what matters","Makes you richer automatically"],"answer":1},
    {"type":"tie_in","body":"Look at your last earn. Was it planned, or did it just happen? That''s the difference a budget makes."},
    {"type":"done","body":"Budget = control. Control = you get the stuff you actually want."}
  ]}
  $BODY$::jsonb),

  ('goal-math', 'Earning and choosing', 'Math makes goals real', 21, 10, 12, $BODY$
  {"steps":[
    {"type":"hook","title":"Takkies for R600","body":"You want a R600 pair of takkies. You can save R75 a week. How many weeks until they''re yours?"},
    {"type":"concept","title":"Target ÷ weekly = weeks","body":"Goal math is simple: target divided by weekly savings = weeks needed. R600 ÷ R75 = 8 weeks. That''s a real countdown, not a wish. Without the math, a goal is just a feeling."},
    {"type":"quiz","question":"A skateboard costs R1200. You save R50 a week. How many weeks?","options":["12","24","60"],"answer":1},
    {"type":"tie_in","body":"Set one goal in BudgetWise. Enter the target. Watch the weeks count down as you save. That''s adult-level planning at 11."},
    {"type":"done","body":"Goals + math = stuff you actually buy. No more ''someday.''"}
  ]}
  $BODY$::jsonb),

  ('scam-spotting', 'Earning and choosing', 'Spot the scam', 22, 10, 12, $BODY$
  {"steps":[
    {"type":"hook","title":"The R10,000 text","body":"A message says: ''Congrats! You''ve won R10,000! Click here fast.'' What do you do?"},
    {"type":"concept","title":"Urgency + money + fake authority = scam","body":"Scammers use three tricks: URGENCY (''claim now!''), MONEY (''you won!''), and FAKE AUTHORITY (''this is SARS''). Real prizes don''t ask you to pay first. Real banks don''t ask for your PIN. If it feels too good, it is."},
    {"type":"quiz","question":"What''s the biggest red flag?","options":["The message uses emojis","You have to click a link fast or lose the prize","It''s in English"],"answer":1},
    {"type":"tie_in","body":"Show any ''you won'' message to an adult before clicking. Those 5 seconds are your best defence."},
    {"type":"done","body":"You pause before you tap. Scammers hate that."}
  ]}
  $BODY$::jsonb);

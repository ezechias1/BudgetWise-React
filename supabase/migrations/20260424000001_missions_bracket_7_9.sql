-- Junior Phase 6 — bracket 7-9 missions: "Money is a tool"
-- 5 original missions. SA localisation (rands, Pick n Pay, stokvel).

insert into kid_missions (slug, unit, title, ord, age_min, age_max, body) values
  ('money-is-trade', 'Money is a tool', 'What is money, really?', 13, 7, 9, $BODY$
  {"steps":[
    {"type":"hook","title":"Before money","body":"Long ago, there was no money. If you wanted bread, you had to give the baker three chickens. Imagine trying to buy sweets by carrying chickens to the shop."},
    {"type":"concept","title":"Money is a shortcut","body":"Money is just a piece of paper or metal we all agree is worth something. It makes trading easy — no chickens needed. A R10 coin means ''I did R10 of work someone wanted.''"},
    {"type":"quiz","question":"Why did people invent money?","options":["To make kids rich","So we don''t have to swap actual things","Because coins look cool"],"answer":1},
    {"type":"tie_in","body":"The R5 in your pocket came from someone doing work that was worth R5. Money is a way of saying ''thank you for that work.''"},
    {"type":"done","body":"You get money now. It''s a receipt for work. Not magic — just useful."}
  ]}
  $BODY$::jsonb),

  ('needs-wants-basic', 'Money is a tool', 'Needs vs wants', 14, 7, 9, $BODY$
  {"steps":[
    {"type":"hook","title":"The R50 test","body":"If the shop only had R50 and you had one chance to spend it, would you buy bread, ice cream, or a new toy?"},
    {"type":"concept","title":"What keeps you alive?","body":"Needs keep you alive and healthy — food, water, a warm bed, clothes. Wants are nice but you survive without them. Wait a day. Most wants stop feeling so important."},
    {"type":"quiz","question":"Which of these is a NEED?","options":["A new phone","Water to drink","A PS5"],"answer":1},
    {"type":"tie_in","body":"Next time you say ''I need this!'' — ask: will I still need it tomorrow? If no, it''s a want pretending."},
    {"type":"done","body":"You can spot a want in disguise. That''s a superpower most adults don''t have."}
  ]}
  $BODY$::jsonb),

  ('save-waiting-game', 'Money is a tool', 'Why waiting makes money bigger', 15, 7, 9, $BODY$
  {"steps":[
    {"type":"hook","title":"The choice","body":"Would you rather have R20 right now, or R100 in 30 days? Most kids say R20. Then kick themselves a month later."},
    {"type":"concept","title":"Saving is just waiting","body":"Waiting is hard. But waiting for more money is exactly what saving is. R20 feels fast. R100 is worth five times more. Every time you choose ''more later'' over ''less now,'' your Save jar grows."},
    {"type":"quiz","question":"You save R10 every week for 10 weeks. How much do you have?","options":["R20","R100","R1000"],"answer":1},
    {"type":"tie_in","body":"Pick one thing you want. Look at the price. Divide by how much you can save each week. That number is how many weeks away it is — and it''s a real countdown."},
    {"type":"done","body":"You know the saver''s secret. Small + patient = big."}
  ]}
  $BODY$::jsonb),

  ('three-jars-intro', 'Money is a tool', 'Three jars: Save, Spend, Give', 16, 7, 9, $BODY$
  {"steps":[
    {"type":"hook","title":"Where does it all go?","body":"When R100 comes in, where should it go? Straight to sweets? All of it?"},
    {"type":"concept","title":"Split, don''t spend","body":"Smart money-people split every earn into three jars. SAVE (for bigger things later). SPEND (for today''s fun). GIVE (because helping feels good and keeps you connected). No right split exists — but having three jars means you never run out of any."},
    {"type":"quiz","question":"Which makes your money last longer?","options":["Spending everything fast","Splitting into Save, Spend, Give","Hiding it under your pillow"],"answer":1},
    {"type":"tie_in","body":"Open the Jars page and set your split. Your next earn will divide automatically."},
    {"type":"done","body":"You''re not just getting money. You''re managing it. Big difference."}
  ]}
  $BODY$::jsonb),

  ('counting-change', 'Money is a tool', 'Counting your change', 17, 7, 9, $BODY$
  {"steps":[
    {"type":"hook","title":"R20 for a R17 thing","body":"Something costs R17. You hand over a R20 note. How much comes back?"},
    {"type":"concept","title":"Change = what''s left","body":"Change is what''s left after you pay. Do it in steps: R20 minus R17 = R3. Or ask: R17 plus how much equals R20? The answer is the same. Count your change every time. Shops are usually right, but not always — and you should know."},
    {"type":"quiz","question":"A loaf of bread is R15. You pay with R50. What''s the change?","options":["R15","R35","R50"],"answer":1},
    {"type":"tie_in","body":"Next time you buy something, count the change before you leave the till. If it''s wrong, it''s okay to say so politely."},
    {"type":"done","body":"You can''t be short-changed. You''re the boss of your rands."}
  ]}
  $BODY$::jsonb);

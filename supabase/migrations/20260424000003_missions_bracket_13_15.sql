-- Junior Phase 6 — bracket 13-15 missions: "Budgeting basics"
-- 5 original missions. Real SA institutions (SARS, VAT, Capitec, TymeBank).

insert into kid_missions (slug, unit, title, ord, age_min, age_max, body) values
  ('fifty-thirty-twenty', 'Budgeting basics', 'The 50/30/20 rule', 23, 13, 15, $BODY$
  {"steps":[
    {"type":"hook","title":"Adults have a rule","body":"Adults have a rough rule for where their money goes. It''s called 50/30/20. Three numbers, your whole budget."},
    {"type":"concept","title":"Needs, wants, future","body":"Of every R100 you earn: R50 goes to NEEDS (rent, food, transport). R30 to WANTS (takeaways, streaming, takkies). R20 to SAVINGS (emergency fund, long-term goals). It''s not a law — it''s a starting point that works for most people in most months. Adjust for your reality, but start here."},
    {"type":"quiz","question":"In the 50/30/20 rule, what percentage is for savings?","options":["50%","20%","30%"],"answer":1},
    {"type":"tie_in","body":"Take your last allowance or earn. Try splitting it 50/30/20 on paper. Feel how it lands."},
    {"type":"done","body":"You have an adult framework. Use it, tune it, own it."}
  ]}
  $BODY$::jsonb),

  ('interest-basics', 'Budgeting basics', 'Interest — the cost of time', 24, 13, 15, $BODY$
  {"steps":[
    {"type":"hook","title":"The R10 extra","body":"Your friend borrows R100 from you and promises R110 back in a month. That extra R10 is interest."},
    {"type":"concept","title":"Interest works both ways","body":"Interest goes both ways. A savings account pays YOU interest (the bank rents your money). A credit card charges YOU interest (you''re renting theirs). SA savings rates are around 5–8% per year; credit card rates are 15–25%. That gap is how lenders make money. Always check which side of the gap you''re on."},
    {"type":"quiz","question":"You borrow R1000 at 20% interest for one year. How much do you pay back?","options":["R1020","R1200","R2000"],"answer":1},
    {"type":"tie_in","body":"When you see ''buy now, pay later,'' look for the interest rate. That''s the real price. If they hide it, walk away."},
    {"type":"done","body":"Interest isn''t evil — but it''s always there. Now you can spot it."}
  ]}
  $BODY$::jsonb),

  ('vat-and-sars', 'Budgeting basics', 'Where the R15 goes (VAT)', 25, 13, 15, $BODY$
  {"steps":[
    {"type":"hook","title":"R100 becomes R115","body":"The price tag says R100. At the till it''s R115. Where did the extra R15 go?"},
    {"type":"concept","title":"VAT pays for the country","body":"In South Africa, most things have 15% VAT (Value-Added Tax) added. It goes to SARS (the national tax collector), which pays for roads, schools, hospitals, and police. Every time you buy, a small piece funds society. Adults also pay income tax on what they earn — bigger story — but VAT is where your pocket money meets government."},
    {"type":"quiz","question":"What does VAT pay for?","options":["The shop owner''s holiday","Government services like roads and schools","Nothing, it''s a scam"],"answer":1},
    {"type":"tie_in","body":"Look at your next till slip. The ''VAT'' line shows how much went to SARS. Most people never look."},
    {"type":"done","body":"You know where that R15 went. More than most adults can explain."}
  ]}
  $BODY$::jsonb),

  ('twentyfour-hour-rule', 'Budgeting basics', 'The 24-hour rule', 26, 13, 15, $BODY$
  {"steps":[
    {"type":"hook","title":"30% off! Right now!","body":"You''re in a shop. A thing is 30% off. You HAVE to buy it now, right?"},
    {"type":"concept","title":"Sales short-circuit your brain","body":"Sales are designed to bypass thinking. FOMO + a countdown = you buy things you''d never buy at full price. The rule: if it''s over R200 and you didn''t plan to buy it, wait 24 hours. Most of the time, you won''t come back. The ones you do come back for are the real wants."},
    {"type":"quiz","question":"Why does the 24-hour rule work?","options":["Prices always drop the next day","Most ''urgent'' buys stop feeling urgent after a pause","It''s the law"],"answer":1},
    {"type":"tie_in","body":"Next impulse buy, set a 24h phone timer. See what you actually still want when it goes off."},
    {"type":"done","body":"You outsmart the marketing machine. Real money saved."}
  ]}
  $BODY$::jsonb),

  ('first-bank-account', 'Budgeting basics', 'Your first bank account', 27, 13, 15, $BODY$
  {"steps":[
    {"type":"hook","title":"You''re old enough","body":"You''re 13-ish. Some banks will let you open a youth account with a parent. Here''s what to ask for."},
    {"type":"concept","title":"What good looks like","body":"Good kid/teen accounts (TymeBank from 12 with parent, FNB Fusion from 16, Capitec Global One from 16) share features: no monthly fee, a free card, simple app. Avoid accounts with confusing ''bundle'' fees. And — always: never share your PIN. Even with family. That''s a lifetime rule."},
    {"type":"quiz","question":"Which is a BAD feature in a first bank account?","options":["No monthly fees","High monthly fees you can''t explain","A card you can tap"],"answer":1},
    {"type":"tie_in","body":"Ask your parents: do I have an account already? If not, what would we need to open one?"},
    {"type":"done","body":"You know what to ask for. Banks love kids who know what they want."}
  ]}
  $BODY$::jsonb);

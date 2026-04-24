-- Junior Phase 6 — bracket 16-17 missions: "Adult lite"
-- 5 original missions. Real SA finance: PAYE, UIF, TransUnion, Experian.

insert into kid_missions (slug, unit, title, ord, age_min, age_max, body) values
  ('credit-vs-debit', 'Adult lite', 'Credit vs debit', 28, 16, 17, $BODY$
  {"steps":[
    {"type":"hook","title":"Same plastic, two worlds","body":"Same card-shaped rectangle. Credit or debit. What''s the actual difference — and why does it matter?"},
    {"type":"concept","title":"Whose money are you spending?","body":"DEBIT spends YOUR money from YOUR bank account. If R50 is in there, R50 is your limit. No debt. CREDIT spends the BANK''S money — you pay it back later, usually with interest if you don''t clear the full balance. Used well, credit builds your financial reputation (credit score). Used badly, minimum payments trap you for years. Most 16–17 year olds don''t need credit yet. But know the difference before the first offer arrives."},
    {"type":"quiz","question":"Which card costs you interest if you don''t pay the bill in full?","options":["Debit","Credit","Both always"],"answer":1},
    {"type":"tie_in","body":"First credit card offer you see, read the fine print. Two numbers matter: ''interest-free days'' and ''annual fee.''"},
    {"type":"done","body":"You won''t get trapped by the first shiny card. That''s rare."}
  ]}
  $BODY$::jsonb),

  ('credit-score-basics', 'Adult lite', 'Credit score basics', 29, 16, 17, $BODY$
  {"steps":[
    {"type":"hook","title":"The number that follows you","body":"In SA, there''s a number that quietly tracks your financial reputation. It''s called a credit score. Most adults don''t know theirs."},
    {"type":"concept","title":"0 to 999, built over years","body":"Credit scores (run by bureaus like TransUnion and Experian) range 0–999 in SA. Higher = lenders trust you = cheaper loans later. It''s built by: paying what you owe on time (huge factor), not maxing out credit you''re given, having some history. It''s broken by: missed payments, defaults, judgments. You can check yours free once a year. Start building a good one in your twenties — it pays off when you rent or buy property."},
    {"type":"quiz","question":"What builds a good credit score?","options":["Avoiding credit forever","Paying what you owe on time, every time","Having lots of credit cards"],"answer":1},
    {"type":"tie_in","body":"When you turn 18, pull your credit report free at one of the bureaus. Spotting a mistake early saves years of pain."},
    {"type":"done","body":"You know the number that matters. Most adults will ask how."}
  ]}
  $BODY$::jsonb),

  ('gross-vs-net', 'Adult lite', 'Your first salary — gross vs net', 30, 16, 17, $BODY$
  {"steps":[
    {"type":"hook","title":"R10,000 offered, R8,100 lands","body":"You accept a job at R10,000/month. First payslip arrives. It says R8,100. Where''s the rest?"},
    {"type":"concept","title":"Deductions you''ll see","body":"GROSS pay is what you''re offered. NET is what lands in your account. Deductions include: income tax (PAYE — scales with earnings, goes to SARS), UIF (1% — unemployment insurance), medical aid, and pension/provident contributions. First-job surprise: no income tax until you earn over ~R95,750/year, but UIF kicks in from the first rand. Always budget from NET, never gross."},
    {"type":"quiz","question":"Budgeting off your gross salary is:","options":["Fine, numbers will balance","Dangerous — you''ll overspend because real money is smaller","What tax experts recommend"],"answer":1},
    {"type":"tie_in","body":"First job offer you get, ask for the NET estimate. If they can''t give one, ask them to."},
    {"type":"done","body":"You won''t be surprised by your first payslip. That''s power."}
  ]}
  $BODY$::jsonb),

  ('rent-vs-buy', 'Adult lite', 'Rent vs buy — a thinking model', 31, 16, 17, $BODY$
  {"steps":[
    {"type":"hook","title":"''Renting is wasted money''","body":"Adults love saying renting is wasted money. Is that actually true?"},
    {"type":"concept","title":"Equity vs freedom","body":"Buying a home builds EQUITY — part of it becomes yours with every payment. Renting buys FREEDOM — no massive deposit, easy to move. Which is smarter depends on: how long you''ll stay (buying usually beats renting after 5–7 years), your job stability, the local market, and whether you have the 10–20% deposit. It''s not ''renting is dumb'' — it''s ''renting is smart if you might move, buying is smart if you''ll stay and the math works.'' Most 20-somethings should rent first."},
    {"type":"quiz","question":"What does buying a home do that renting doesn''t?","options":["Builds your credit score instantly","Builds equity — you own a growing share","Doubles your income"],"answer":1},
    {"type":"tie_in","body":"Don''t let anyone pressure you into buying at 22 if you''re not sure you''ll stay. Time in the home matters more than timing the market."},
    {"type":"done","body":"You can hold your own in the adulting conversation."}
  ]}
  $BODY$::jsonb),

  ('emergency-fund', 'Adult lite', 'The emergency fund', 32, 16, 17, $BODY$
  {"steps":[
    {"type":"hook","title":"Car breaks down, 28th of the month","body":"Your car breaks down. Repairs cost R8,000. It''s the 28th and your salary''s late. What do you do?"},
    {"type":"concept","title":"Three to six months, boring savings","body":"An emergency fund is 3–6 months of your essential expenses, sitting in a boring savings account doing nothing — until you need it. It keeps a flat tyre from becoming a credit card debt. Build it BEFORE you chase investments or fancy holidays. Even one month saved puts you ahead of most adults."},
    {"type":"quiz","question":"How big should your emergency fund be?","options":["R500 — enough for a tank of petrol","3–6 months of essential expenses","Whatever''s left over"],"answer":1},
    {"type":"tie_in","body":"First real job: target 1 month of essentials in 6 months. Tiny deposits. Big peace of mind."},
    {"type":"done","body":"You know the first adult money move. Most people skip it and regret it."}
  ]}
  $BODY$::jsonb);

import { createClient } from '@supabase/supabase-js';

// Reuses the same Supabase project as the vanilla BudgetWise app so both
// versions read/write the same data during the migration.
const SUPABASE_URL = 'https://trkdlwukjyupvvcyzebf.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRya2Rsd3Vranl1cHZ2Y3l6ZWJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTc3MjQsImV4cCI6MjA4ODI5MzcyNH0.eSivGwjPLe0aE41Z1EnnwN5eBykMNcQAYaCtEgde55I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

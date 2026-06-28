// Supabase project connection details.
// Replace these two values with your own project's URL and public anon key.
// Find them in Supabase: Project Settings -> API.
const SUPABASE_URL = 'https://ibxsythbgvumguhxljrn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_anLHkZx-Xxko0gj0Re2ZGQ_mK4BhU_V';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

-- Allow users to create their own profile row (app uses upsert when missing)

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

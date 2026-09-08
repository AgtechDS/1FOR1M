-- 1FOR1M Supabase Schema
-- 1 million lots at 1€ each

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS (Google OAuth via Supabase Auth) ───
-- Supabase Auth handles Google OAuth automatically.
-- Public profile table linked to auth.users
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    google_id TEXT,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (google_id)
);

-- ─── LOTS (1 million) ───
CREATE TABLE public.lots (
    id BIGSERIAL PRIMARY KEY,
    lot_number INTEGER NOT NULL UNIQUE,  -- 1 to 1,000,000
    price_eur INTEGER DEFAULT 1,          -- 1 euro
    status TEXT DEFAULT 'available' CHECK (status IN ('available', 'sold', 'reserved')),
    image_url TEXT,
    video_url TEXT,
    audio_url TEXT,
    image_width INTEGER,
    image_height INTEGER,
    purchased_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    purchased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by lot number
CREATE INDEX idx_lots_lot_number ON public.lots (lot_number);
CREATE INDEX idx_lots_status ON public.lots (status);
CREATE INDEX idx_lots_purchased_by ON public.lots (purchased_by);

-- ─── PURCHASES ───
CREATE TABLE public.purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    amount_eur INTEGER NOT NULL,  -- total in cents
    currency TEXT DEFAULT 'eur',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    lot_numbers INTEGER[],  -- array of lot numbers purchased
    shipping_name TEXT,
    shipping_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_purchases_user_id ON public.purchases (user_id);
CREATE INDEX idx_purchases_stripe_payment_intent_id ON public.purchases (stripe_payment_intent_id);
CREATE INDEX idx_purchases_status ON public.purchases (status);

-- ─── MEDIA UPLOADS (per lot, hover-triggered) ───
CREATE TABLE public.media_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lot_id BIGINT NOT NULL REFERENCES public.lots (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio')),
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration_seconds INTEGER,
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_media_uploads_lot_id ON public.media_uploads (lot_id);
CREATE INDEX idx_media_uploads_user_id ON public.media_uploads (user_id);

-- ─── STORAGE BUCKETS ───
-- Run these in Supabase Dashboard > Storage
-- INSERT INTO storage.buckets (id, name, public) VALUES ('lots-media', 'lots-media', true);

-- ─── ROW LEVEL SECURITY ───
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Anyone can view available lots
CREATE POLICY "Anyone can view lots" ON public.lots
    FOR SELECT USING (true);

-- Only authenticated users can update lots (via edge function/server)
-- Lots are managed server-side

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases" ON public.purchases
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create purchases" ON public.purchases
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can view media for lots they own or are public
CREATE POLICY "Users can view media" ON public.media_uploads
    FOR SELECT USING (true);

CREATE POLICY "Users can upload media" ON public.media_uploads
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ─── SEED 1 MILLION LOTS ───
-- Use a generate_series for efficiency
INSERT INTO public.lots (lot_number, price_eur, status)
SELECT generate_series(1, 1000000), 1, 'available';

-- ─── FUNCTIONS ───

-- Purchase lots atomically
CREATE OR REPLACE FUNCTION purchase_lots(
    p_user_id UUID,
    p_lot_numbers INTEGER[],
    p_amount_eur INTEGER
) RETURNS UUID AS $$
DECLARE
    v_purchase_id UUID;
    v_available_count INTEGER;
BEGIN
    -- Check all lots are available
    SELECT COUNT(*) INTO v_available_count
    FROM public.lots
    WHERE lot_number = ANY(p_lot_numbers)
      AND status = 'available';

    IF v_available_count != array_length(p_lot_numbers, 1) THEN
        RAISE EXCEPTION 'Some lots are not available';
    END IF;

    -- Create purchase record
    INSERT INTO public.purchases (user_id, lot_numbers, amount_eur, quantity, status)
    VALUES (p_user_id, p_lot_numbers, p_amount_eur, array_length(p_lot_numbers, 1), 'pending')
    RETURNING id INTO v_purchase_id;

    RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark lots as sold after successful Stripe payment
CREATE OR REPLACE FUNCTION complete_purchase(
    p_stripe_payment_intent_id TEXT
) RETURNS VOID AS $$
DECLARE
    v_purchase RECORD;
BEGIN
    SELECT * INTO v_purchase
    FROM public.purchases
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase not found';
    END IF;

    -- Mark lots as sold
    UPDATE public.lots
    SET status = 'sold',
        purchased_by = v_purchase.user_id,
        purchased_at = now()
    WHERE lot_number = ANY(v_purchase.lot_numbers);

    -- Mark purchase as completed
    UPDATE public.purchases
    SET status = 'completed', completed_at = now()
    WHERE id = v_purchase.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: users_role_immutable_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.users_role_immutable_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role is immutable after registration'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: ad_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_name text NOT NULL,
    contact_email text NOT NULL,
    image_url text NOT NULL,
    target_url text NOT NULL,
    target_city_id text,
    target_category text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    amount_cents bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    impressions_count bigint DEFAULT 0 NOT NULL,
    clicks_count bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_campaigns_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT ad_campaigns_dates_valid CHECK ((ends_at > starts_at)),
    CONSTRAINT ad_campaigns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'expired'::text, 'pending_payment'::text])))
);


--
-- Name: TABLE ad_campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ad_campaigns IS 'External brand campaigns (Coca-Cola, banks, etc.) shown as cards in /mapa + /vendors';


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT admin_notes_target_type_check CHECK ((target_type = ANY (ARRAY['user'::text, 'vendor'::text])))
);


--
-- Name: ads; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ads AS
 SELECT id,
    brand_name,
    image_url,
    target_url,
    (status = 'active'::text) AS is_active,
    starts_at,
    ends_at,
    0 AS priority,
    created_at
   FROM public.ad_campaigns;


--
-- Name: VIEW ads; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.ads IS 'Public read shape for external brand campaigns. Backed by ad_campaigns. Does NOT expose contact_email, amount_cents, or created_by — those are admin-only. Window filtering (is_active + starts_at/ends_at) happens in the listing query; this view exposes all rows so admin tooling can still see paused/expired ones.';


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id text NOT NULL,
    label text NOT NULL,
    icon text
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id text NOT NULL,
    name text NOT NULL,
    department text NOT NULL,
    center_lat double precision NOT NULL,
    center_lng double precision NOT NULL,
    timezone text DEFAULT 'America/Bogota'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consent_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email character varying(255),
    consent_type character varying(50) NOT NULL,
    policy_version character varying(20) NOT NULL,
    granted boolean NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE email_verification_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_verification_tokens IS 'One-time email verification tokens. We store the SHA-256 hash of the
  token, never the plaintext, so a DB dump alone can''t be used to verify
  arbitrary emails. The plaintext token only lives in the email the user
  receives, once.';


--
-- Name: COLUMN email_verification_tokens.token_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_verification_tokens.token_hash IS 'SHA-256 of the token (base64url). The plaintext is only sent to the
  user''s email and is never stored.';


--
-- Name: COLUMN email_verification_tokens.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_verification_tokens.expires_at IS 'Tokens expire 24 hours after creation. The /api/auth/verify-email
  endpoint returns 410 Gone for expired tokens.';


--
-- Name: COLUMN email_verification_tokens.used_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_verification_tokens.used_at IS 'Set when the token is consumed. NULL means the token is still active
  (or expired, depending on expires_at).';


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id bigint NOT NULL,
    job_name text NOT NULL,
    payload jsonb,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_runs_id_seq OWNED BY public.job_runs.id;


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    quantity integer DEFAULT 1,
    price numeric(10,2) NOT NULL,
    CONSTRAINT order_items_price_positive CHECK (((price > (0)::numeric) AND (price <= 99999999.99))),
    CONSTRAINT order_items_quantity_range CHECK (((quantity >= 1) AND (quantity <= 999)))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    status text DEFAULT 'pending'::text,
    total numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'ready'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    url text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_photos_position_range CHECK ((("position" >= 0) AND ("position" <= 999))),
    CONSTRAINT product_photos_url_format CHECK ((((length(url) >= 1) AND (length(url) <= 2048)) AND (url ~ '^(https?://[^\s]+|/products/[^\s]+|/storage/[^\s]+)$'::text)))
);


--
-- Name: TABLE product_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_photos IS 'Multiple photos per product. First by position is primary.';


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    photo_url text,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL,
    kind character varying(16) DEFAULT 'product'::character varying NOT NULL,
    duration_minutes integer,
    modality character varying(16),
    pricing_unit character varying(16),
    CONSTRAINT products_description_length CHECK (((description IS NULL) OR (length(description) <= 5000))),
    CONSTRAINT products_duration_minutes_check CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 5) AND (duration_minutes <= 600)))),
    CONSTRAINT products_kind_check CHECK (((kind)::text = ANY ((ARRAY['product'::character varying, 'service'::character varying])::text[]))),
    CONSTRAINT products_kind_fields_consistent CHECK (((((kind)::text = 'product'::text) AND (duration_minutes IS NULL) AND (modality IS NULL) AND (pricing_unit IS NULL)) OR (((kind)::text = 'service'::text) AND (duration_minutes IS NOT NULL) AND (modality IS NOT NULL) AND (pricing_unit IS NOT NULL)))),
    CONSTRAINT products_modality_check CHECK (((modality IS NULL) OR ((modality)::text = ANY ((ARRAY['on_site'::character varying, 'travels'::character varying, 'remote'::character varying])::text[])))),
    CONSTRAINT products_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200))),
    CONSTRAINT products_photo_url_format CHECK (((photo_url IS NULL) OR (photo_url ~ '^(https?://[^\s]+|/products/[^\s]+|/storage/[^\s]+)$'::text))),
    CONSTRAINT products_price_positive CHECK (((price > (0)::numeric) AND (price <= 99999999.99))),
    CONSTRAINT products_pricing_unit_check CHECK (((pricing_unit IS NULL) OR ((pricing_unit)::text = ANY ((ARRAY['unit'::character varying, 'hour'::character varying, 'session'::character varying, 'class'::character varying])::text[]))))
);


--
-- Name: COLUMN products.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.is_active IS 'Sprint 6 D.1: per-product visibility toggle. True = visible in public catalog. False = hidden from buyers but kept for the seller.';


--
-- Name: COLUMN products.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.kind IS 'Migration 102: discriminator. ''product'' = physical good; ''service'' = session/class with duration + modality + pricing_unit.';


--
-- Name: COLUMN products.duration_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.duration_minutes IS 'Migration 102: service-only. 5..600 minutes. NULL when kind=''product''.';


--
-- Name: COLUMN products.modality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.modality IS 'Migration 102: service-only. on_site (client visits provider), travels (provider visits client — e.g. peluquería a domicilio), remote (online). NULL when kind=''product''.';


--
-- Name: COLUMN products.pricing_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.pricing_unit IS 'Migration 102: service-only. unit|hour|session|class — a label, not a multiplier. NULL when kind=''product''.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text,
    name text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    token_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['buyer'::text, 'seller'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_attempts (
    id bigint NOT NULL,
    ip text,
    bucket text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    identifier text,
    CONSTRAINT rate_limit_attempts_keyed_by_one CHECK ((((
CASE
    WHEN (ip IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (user_id IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (identifier IS NOT NULL) THEN 1
    ELSE 0
END) = 1))
);


--
-- Name: rate_limit_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_limit_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_limit_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_limit_attempts_id_seq OWNED BY public.rate_limit_attempts.id;


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    author_name text NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    CONSTRAINT reviews_author_name_length_check CHECK (((length(btrim(author_name)) >= 1) AND (length(btrim(author_name)) <= 100))),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: sponsorships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsorships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    plan text NOT NULL,
    amount_cents bigint NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    wompi_reference text,
    payment_method text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    CONSTRAINT sponsorships_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT sponsorships_dates_valid CHECK ((ends_at > starts_at)),
    CONSTRAINT sponsorships_plan_check CHECK ((plan = ANY (ARRAY['semanal'::text, 'mensual'::text]))),
    CONSTRAINT sponsorships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'expired'::text, 'pending_payment'::text])))
);


--
-- Name: TABLE sponsorships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sponsorships IS 'Vendor self-paid promotion: aparece primero en /mapa y /vendors durante la ventana';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    password_hash text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    phone text,
    city_id text,
    is_active boolean DEFAULT true NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    email_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    CONSTRAINT users_email_or_phone_required CHECK (((email IS NOT NULL) OR (phone IS NOT NULL))),
    CONSTRAINT users_name_charset_check CHECK (((name !~ '^[[:cntrl:]]'::text) AND (name !~ '[[:cntrl:]]$'::text))),
    CONSTRAINT users_name_length_check CHECK (((length(name) >= 2) AND (length(name) <= 100))),
    CONSTRAINT users_phone_format_check CHECK (((phone IS NULL) OR (((length(phone) >= 10) AND (length(phone) <= 15)) AND (phone ~ '^[0-9]+$'::text)))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['buyer'::text, 'seller'::text, 'admin'::text])))
);


--
-- Name: COLUMN users.email_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.email_verified IS 'True once the user has clicked the verification link in their email.
  Required to be true for: POST /api/vendors, POST /api/reviews,
  POST /api/contact. Soft-blocked (banner) for everything else.';


--
-- Name: COLUMN users.email_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.email_verified_at IS 'Audit trail of when the user verified their email. NULL until verified.';


--
-- Name: COLUMN users.last_login_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.last_login_at IS 'Last successful POST /api/auth/login for this user. NULL until the first login after this migration. Updated on every successful login (L6 audit 2026-07-27). Pairs with login_failure audit logs in pino JSON for forensic timeline correlation.';


--
-- Name: CONSTRAINT users_name_charset_check ON users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT users_name_charset_check ON public.users IS 'Display name cannot start or end with a control character (defense against bidi/zero-width masking).';


--
-- Name: CONSTRAINT users_name_length_check ON users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT users_name_length_check ON public.users IS 'Display name must be 2..100 chars (inclusive). Padded with sanitize+trim at the API.';


--
-- Name: CONSTRAINT users_phone_format_check ON users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT users_phone_format_check ON public.users IS 'Phone, when present, must be 10-15 digits only (no country prefix 57; the app strips it on input). NULL allowed (paired with users_email_or_phone_required).';


--
-- Name: vendor_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    buyer_id uuid,
    contact_type character varying(20) NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_contacts_contact_type_check CHECK (((contact_type)::text = ANY ((ARRAY['call'::character varying, 'whatsapp'::character varying, 'directions'::character varying])::text[])))
);


--
-- Name: vendor_location_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_location_history (
    id bigint NOT NULL,
    vendor_id uuid NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_location_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_location_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_location_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_location_history_id_seq OWNED BY public.vendor_location_history.id;


--
-- Name: vendor_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_views (
    id integer NOT NULL,
    vendor_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    user_ip text
);


--
-- Name: vendor_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_views_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_views_id_seq OWNED BY public.vendor_views.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid,
    name text NOT NULL,
    description text,
    category text,
    latitude double precision,
    longitude double precision,
    is_active boolean DEFAULT true,
    rating numeric(2,1) DEFAULT 0,
    review_count integer DEFAULT 0,
    photo_url text,
    created_at timestamp with time zone DEFAULT now(),
    phone text,
    city_id text,
    is_verified boolean DEFAULT false,
    location_updated_at timestamp with time zone,
    vehicle_type text,
    vehicle_photo_url text,
    slug text,
    business_hours_enabled boolean DEFAULT false,
    business_hours_start time without time zone,
    business_hours_end time without time zone,
    business_days text[] DEFAULT ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text],
    station_type text,
    geo_mode character varying(20) DEFAULT 'precise'::character varying NOT NULL,
    geo_zone_lat double precision,
    geo_zone_lng double precision,
    geo_zone_radius_m integer,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT vendors_category_check CHECK (((category IS NOT NULL) AND (category = ANY (ARRAY['frutas'::text, 'comida'::text, 'bebidas'::text, 'artesanias'::text, 'ropa'::text, 'otros'::text, 'clases'::text, 'bienestar'::text, 'belleza'::text, 'hogar'::text, 'eventos'::text])))),
    CONSTRAINT vendors_city_id_check CHECK (((city_id IS NOT NULL) AND (city_id = ANY (ARRAY['bogota'::text, 'medellin'::text, 'cali'::text, 'barranquilla'::text, 'cartagena'::text, 'bucaramanga'::text, 'cucuta'::text, 'pereira'::text, 'ibague'::text, 'manizales'::text, 'santa-marta'::text, 'villavicencio'::text, 'pasto'::text, 'neiva'::text, 'armenia'::text, 'sincelejo'::text, 'tunja'::text, 'riohacha'::text])))),
    CONSTRAINT vendors_geo_mode_check CHECK (((geo_mode)::text = ANY ((ARRAY['precise'::character varying, 'battery'::character varying])::text[]))),
    CONSTRAINT vendors_geo_zone_radius_m_check CHECK (((geo_zone_radius_m IS NULL) OR ((geo_zone_radius_m >= 100) AND (geo_zone_radius_m <= 5000)))),
    CONSTRAINT vendors_station_type_check CHECK (((station_type IS NULL) OR (station_type = ANY (ARRAY['fixed'::text, 'mobile'::text])))),
    CONSTRAINT vendors_vehicle_type_check CHECK ((vehicle_type = ANY (ARRAY['bicicleta'::text, 'moto'::text, 'carro'::text, 'pie'::text, 'triciclo'::text, 'otro'::text])))
);


--
-- Name: COLUMN vendors.vehicle_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.vehicle_type IS 'How the vendor moves around — used for filtering and "advertise on carts" feature';


--
-- Name: COLUMN vendors.vehicle_photo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.vehicle_photo_url IS 'Photo of the cart/vehicle shown to buyers for trust';


--
-- Name: COLUMN vendors.business_hours_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.business_hours_enabled IS 'When true, vendor auto-toggles is_active based on hours/days';


--
-- Name: COLUMN vendors.business_hours_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.business_hours_start IS 'Start of business hours (local time)';


--
-- Name: COLUMN vendors.business_hours_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.business_hours_end IS 'End of business hours (local time). NULL = 24h.';


--
-- Name: COLUMN vendors.business_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.business_days IS 'Days of week: mon, tue, wed, thu, fri, sat, sun';


--
-- Name: COLUMN vendors.station_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.station_type IS 'fixed = always in the same spot. mobile = moves around the city. NULL allowed but discouraged.';


--
-- Name: COLUMN vendors.geo_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.geo_mode IS 'precise = push GPS every 10s. battery = push only when leaving a saved zone.';


--
-- Name: COLUMN vendors.geo_zone_lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.geo_zone_lat IS 'When geo_mode=battery: last known center of the vendor''s circle (server-side, updated when the vendor crosses the boundary).';


--
-- Name: COLUMN vendors.geo_zone_lng; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.geo_zone_lng IS 'When geo_mode=battery: longitude counterpart of geo_zone_lat.';


--
-- Name: COLUMN vendors.geo_zone_radius_m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.geo_zone_radius_m IS 'When geo_mode=battery: radius in meters around geo_zone_lat/geo_zone_lng. Constrained 100..5000.';


--
-- Name: vendors_with_sponsorship; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vendors_with_sponsorship AS
 SELECT id,
    profile_id,
    name,
    description,
    category,
    latitude,
    longitude,
    is_active,
    rating,
    review_count,
    photo_url,
    created_at,
    phone,
    city_id,
    is_verified,
    location_updated_at,
    vehicle_type,
    vehicle_photo_url,
    slug,
    station_type,
    business_hours_enabled,
    business_hours_start,
    business_hours_end,
    business_days,
    (EXISTS ( SELECT 1
           FROM public.sponsorships s
          WHERE ((s.vendor_id = v.id) AND (s.status = 'active'::text) AND (now() >= s.starts_at) AND (now() <= s.ends_at)))) AS is_sponsored,
    COALESCE(( SELECT max(s.ends_at) AS max
           FROM public.sponsorships s
          WHERE ((s.vendor_id = v.id) AND (s.status = 'active'::text))), NULL::timestamp with time zone) AS sponsored_until
   FROM public.vendors v
  WHERE (deleted_at IS NULL);


--
-- Name: job_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs ALTER COLUMN id SET DEFAULT nextval('public.job_runs_id_seq'::regclass);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: rate_limit_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_attempts ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_attempts_id_seq'::regclass);


--
-- Name: vendor_location_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_location_history ALTER COLUMN id SET DEFAULT nextval('public.vendor_location_history_id_seq'::regclass);


--
-- Name: vendor_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_views ALTER COLUMN id SET DEFAULT nextval('public.vendor_views_id_seq'::regclass);


--
-- Name: ad_campaigns ad_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: admin_notes admin_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notes
    ADD CONSTRAINT admin_notes_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: consent_logs consent_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_logs
    ADD CONSTRAINT consent_logs_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_buyer_id_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_buyer_id_vendor_id_key UNIQUE (buyer_id, vendor_id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_filename_key UNIQUE (filename);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: product_photos product_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_photos
    ADD CONSTRAINT product_photos_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_attempts rate_limit_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_attempts
    ADD CONSTRAINT rate_limit_attempts_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: sponsorships sponsorships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsorships
    ADD CONSTRAINT sponsorships_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_contacts vendor_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_contacts
    ADD CONSTRAINT vendor_contacts_pkey PRIMARY KEY (id);


--
-- Name: vendor_location_history vendor_location_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_location_history
    ADD CONSTRAINT vendor_location_history_pkey PRIMARY KEY (id);


--
-- Name: vendor_views vendor_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_views
    ADD CONSTRAINT vendor_views_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: consent_logs_type_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_logs_type_version_idx ON public.consent_logs USING btree (consent_type, policy_version);


--
-- Name: consent_logs_unique_user_type_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_logs_unique_user_type_version ON public.consent_logs USING btree (COALESCE((user_id)::text, (email)::text), consent_type, policy_version) WHERE (user_id IS NOT NULL);


--
-- Name: consent_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_logs_user_id_idx ON public.consent_logs USING btree (user_id, created_at DESC);


--
-- Name: email_verification_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_verification_tokens_expires_idx ON public.email_verification_tokens USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: email_verification_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_verification_tokens_user_idx ON public.email_verification_tokens USING btree (user_id);


--
-- Name: idx_ad_campaigns_active_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_campaigns_active_window ON public.ad_campaigns USING btree (status, starts_at, ends_at) WHERE (status = 'active'::text);


--
-- Name: idx_ad_campaigns_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_campaigns_created_by ON public.ad_campaigns USING btree (created_by);


--
-- Name: idx_ad_campaigns_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_campaigns_target ON public.ad_campaigns USING btree (target_city_id, target_category);


--
-- Name: idx_ad_campaigns_target_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_campaigns_target_category ON public.ad_campaigns USING btree (target_category);


--
-- Name: idx_admin_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_action ON public.admin_audit_log USING btree (action, created_at DESC);


--
-- Name: idx_admin_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_admin ON public.admin_audit_log USING btree (admin_id, created_at DESC);


--
-- Name: idx_admin_audit_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_target ON public.admin_audit_log USING btree (target_type, target_id, created_at DESC);


--
-- Name: idx_admin_notes_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notes_author ON public.admin_notes USING btree (author_id, created_at DESC);


--
-- Name: idx_admin_notes_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notes_target ON public.admin_notes USING btree (target_type, target_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_favorites_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_vendor_id ON public.favorites USING btree (vendor_id);


--
-- Name: idx_job_runs_job_name_ran_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_runs_job_name_ran_at ON public.job_runs USING btree (job_name, ran_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_orders_buyer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_id ON public.orders USING btree (buyer_id, created_at DESC);


--
-- Name: idx_orders_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_vendor_id ON public.orders USING btree (vendor_id, created_at DESC);


--
-- Name: idx_product_photos_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_photos_product_id ON public.product_photos USING btree (product_id, "position");


--
-- Name: idx_products_vendor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_vendor_created ON public.products USING btree (vendor_id, created_at DESC);


--
-- Name: idx_products_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_vendor_id ON public.products USING btree (vendor_id);


--
-- Name: idx_push_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_user ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_rate_limit_identifier_bucket_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_identifier_bucket_time ON public.rate_limit_attempts USING btree (identifier, bucket, attempted_at DESC) WHERE (identifier IS NOT NULL);


--
-- Name: idx_rate_limit_ip_bucket_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_ip_bucket_time ON public.rate_limit_attempts USING btree (ip, bucket, attempted_at DESC);


--
-- Name: idx_rate_limit_user_bucket_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_user_bucket_time ON public.rate_limit_attempts USING btree (user_id, bucket, attempted_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.reviews USING btree (user_id);


--
-- Name: idx_reviews_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_vendor_id ON public.reviews USING btree (vendor_id);


--
-- Name: idx_sponsorships_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sponsorships_expires ON public.sponsorships USING btree (ends_at) WHERE (status = 'active'::text);


--
-- Name: idx_sponsorships_vendor_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sponsorships_vendor_active ON public.sponsorships USING btree (vendor_id) WHERE (status = 'active'::text);


--
-- Name: idx_vendor_location_history_vendor_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_location_history_vendor_time ON public.vendor_location_history USING btree (vendor_id, recorded_at DESC);


--
-- Name: idx_vendor_views_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_views_user_id ON public.vendor_views USING btree (user_id);


--
-- Name: idx_vendor_views_vendor_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_views_vendor_date ON public.vendor_views USING btree (vendor_id, viewed_at);


--
-- Name: idx_vendor_views_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_views_vendor_id ON public.vendor_views USING btree (vendor_id);


--
-- Name: idx_vendors_active_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_active_created_at ON public.vendors USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendors_business_hours_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_business_hours_enabled ON public.vendors USING btree (business_hours_enabled) WHERE (business_hours_enabled = true);


--
-- Name: idx_vendors_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_category ON public.vendors USING btree (category);


--
-- Name: idx_vendors_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_profile_id ON public.vendors USING btree (profile_id);


--
-- Name: idx_vendors_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_slug_idx ON public.vendors USING btree (slug);


--
-- Name: idx_vendors_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vendors_slug_unique ON public.vendors USING btree (slug);


--
-- Name: idx_vendors_station_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_station_type ON public.vendors USING btree (station_type) WHERE (station_type IS NOT NULL);


--
-- Name: password_reset_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_expires_idx ON public.password_reset_tokens USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: password_reset_tokens_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX password_reset_tokens_hash_idx ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: password_reset_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens USING btree (user_id);


--
-- Name: products_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_fts_idx ON public.products USING gin (to_tsvector('spanish'::regconfig, ((COALESCE(name, ''::text) || ' '::text) || COALESCE(description, ''::text))));


--
-- Name: products_is_active_true_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_is_active_true_idx ON public.products USING btree (created_at DESC) WHERE (is_active = true);


--
-- Name: products_kind_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_kind_service_idx ON public.products USING btree (created_at DESC) WHERE ((is_active = true) AND ((kind)::text = 'service'::text));


--
-- Name: profiles_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_email_unique ON public.profiles USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: users_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_phone_unique ON public.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: vendor_contacts_buyer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_contacts_buyer_created_idx ON public.vendor_contacts USING btree (buyer_id, created_at DESC) WHERE (buyer_id IS NOT NULL);


--
-- Name: vendor_contacts_ip_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_contacts_ip_created_idx ON public.vendor_contacts USING btree (ip_address, created_at DESC) WHERE (ip_address IS NOT NULL);


--
-- Name: vendor_contacts_vendor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_contacts_vendor_created_idx ON public.vendor_contacts USING btree (vendor_id, created_at DESC);


--
-- Name: users users_role_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_role_immutable BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_role_immutable_guard();


--
-- Name: TRIGGER users_role_immutable ON users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER users_role_immutable ON public.users IS 'Prevents silent privilege escalation by blocking any UPDATE that changes role (BEFORE UPDATE — fires on every UPDATE; the guard function compares NEW vs OLD, so legitimate role-unchanged writes are unaffected).';


--
-- Name: ad_campaigns ad_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ad_campaigns ad_campaigns_target_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_target_category_fkey FOREIGN KEY (target_category) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: ad_campaigns ad_campaigns_target_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_target_city_id_fkey FOREIGN KEY (target_city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: admin_notes admin_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notes
    ADD CONSTRAINT admin_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: consent_logs consent_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_logs
    ADD CONSTRAINT consent_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_verification_tokens email_verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id);


--
-- Name: favorites favorites_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id);


--
-- Name: orders orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_photos product_photos_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_photos
    ADD CONSTRAINT product_photos_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rate_limit_attempts rate_limit_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_attempts
    ADD CONSTRAINT rate_limit_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: reviews reviews_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: sponsorships sponsorships_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsorships
    ADD CONSTRAINT sponsorships_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: vendor_contacts vendor_contacts_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_contacts
    ADD CONSTRAINT vendor_contacts_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vendor_contacts vendor_contacts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_contacts
    ADD CONSTRAINT vendor_contacts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: vendor_location_history vendor_location_history_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_location_history
    ADD CONSTRAINT vendor_location_history_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: vendor_views vendor_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_views
    ADD CONSTRAINT vendor_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vendor_views vendor_views_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_views
    ADD CONSTRAINT vendor_views_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: vendors vendors_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_category_fkey FOREIGN KEY (category) REFERENCES public.categories(id);


--
-- Name: vendors vendors_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eG78s6R7ii7K22UOmpnaFHUb2OhZikVEXAcNMwZ46FBWbQeEimJfMdjb7N1xmyx

--
-- ZeroFans Database Schema
--
-- Run this against a fresh PostgreSQL database to set up the full schema.
-- Usage: psql -d your_database -f schema.sql
--
-- PostgreSQL database dump
--

\restrict dkJ5JCME0BxQeFxzZm5Lyizw5Z9rGOFyzTzxe1SQyXpyzm3MfqPBSolFjUhiqoj

-- Dumped from database version 18.4 (3ef8dfc)
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: execution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.execution_status AS ENUM (
    'pending',
    'running',
    'success',
    'failed',
    'timeout'
);


--
-- Name: follow_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.follow_status AS ENUM (
    'active',
    'inactive'
);


--
-- Name: media_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_type AS ENUM (
    'image',
    'video',
    'none'
);


--
-- Name: moderation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.moderation_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'review'
);


--
-- Name: post_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.post_visibility AS ENUM (
    'public',
    'subscriber'
);


--
-- Name: relationship_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.relationship_type AS ENUM (
    'follow',
    'subscribe'
);


--
-- Name: skill_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.skill_action_type AS ENUM (
    'http_request',
    'ai_generate',
    'post_to_feed',
    'script',
    'noop'
);


--
-- Name: skill_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.skill_category AS ENUM (
    'content',
    'engagement',
    'analytics',
    'integration',
    'automation',
    'utility'
);


--
-- Name: skill_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.skill_visibility AS ENUM (
    'public',
    'private'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'active',
    'canceled',
    'past_due'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'user',
    'admin'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_communities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid,
    creator_user_id uuid,
    name text NOT NULL,
    path text NOT NULL,
    description text,
    cover_image_url text,
    rules_json jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_creator_check CHECK (((agent_id IS NOT NULL) OR (creator_user_id IS NOT NULL)))
);


--
-- Name: agent_key_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_key_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    public_key text NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_agent_id uuid NOT NULL,
    target_agent_id uuid NOT NULL,
    relationship_type public.relationship_type NOT NULL,
    status public.follow_status DEFAULT 'active'::public.follow_status,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_skills (
    agent_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    config_overrides_json jsonb,
    enabled boolean DEFAULT true,
    equipped_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    token_hash text NOT NULL,
    name text NOT NULL,
    permissions jsonb,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    bio text,
    personality_tags_json jsonb,
    avatar_url text,
    banner_url text,
    skills_json jsonb DEFAULT '[]'::jsonb,
    cli_tools_json jsonb DEFAULT '[]'::jsonb,
    skills_migrated boolean DEFAULT false,
    socials_json jsonb,
    public_key text,
    private_key_encrypted text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid,
    agent_id uuid,
    body_text text NOT NULL,
    content_hash text,
    signature text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comments_author_check CHECK (((user_id IS NOT NULL) OR (agent_id IS NOT NULL)))
);


--
-- Name: community_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    user_id uuid,
    agent_id uuid,
    role text DEFAULT 'member'::text,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    user_id uuid,
    agent_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: email_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid,
    agent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT likes_author_check CHECK (((user_id IS NOT NULL) OR (agent_id IS NOT NULL)))
);


--
-- Name: media_moderation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_moderation (
    media_key text NOT NULL,
    media_url text NOT NULL,
    media_type public.media_type NOT NULL,
    status public.moderation_status NOT NULL,
    reason text,
    blocked_categories_json jsonb,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    visibility public.post_visibility NOT NULL,
    body_text text NOT NULL,
    media_type public.media_type DEFAULT 'none'::public.media_type,
    media_url text,
    ai_generated boolean DEFAULT false,
    content_hash text,
    signature text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: skill_execution_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_execution_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    status public.execution_status DEFAULT 'pending'::public.execution_status,
    input_json jsonb,
    output_json jsonb,
    duration_ms integer DEFAULT 0,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    category public.skill_category NOT NULL,
    input_schema jsonb DEFAULT '{}'::jsonb,
    output_schema jsonb DEFAULT '{}'::jsonb,
    action_type public.skill_action_type NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb,
    visibility public.skill_visibility DEFAULT 'public'::public.skill_visibility,
    creator_agent_id uuid,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    status public.subscription_status NOT NULL,
    plan_type text NOT NULL,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    handle text NOT NULL,
    avatar_url text,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    password_hash text NOT NULL,
    password_salt text,
    suspended_at timestamp with time zone,
    socials_json jsonb,
    date_of_birth text,
    terms_accepted_at timestamp with time zone,
    privacy_accepted_at timestamp with time zone,
    twitter_id text,
    twitter_handle text,
    twitter_avatar_url text,
    auth_provider text DEFAULT 'email'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_communities agent_communities_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_communities
    ADD CONSTRAINT agent_communities_path_unique UNIQUE (path);


--
-- Name: agent_communities agent_communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_communities
    ADD CONSTRAINT agent_communities_pkey PRIMARY KEY (id);


--
-- Name: agent_key_history agent_key_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_key_history
    ADD CONSTRAINT agent_key_history_pkey PRIMARY KEY (id);


--
-- Name: agent_relationships agent_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relationships
    ADD CONSTRAINT agent_relationships_pkey PRIMARY KEY (id);


--
-- Name: agent_skills agent_skills_agent_id_skill_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_agent_id_skill_id_pk PRIMARY KEY (agent_id, skill_id);


--
-- Name: agent_tokens agent_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tokens
    ADD CONSTRAINT agent_tokens_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: agents agents_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_slug_unique UNIQUE (slug);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: community_members community_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_pkey PRIMARY KEY (id);


--
-- Name: community_messages community_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages
    ADD CONSTRAINT community_messages_pkey PRIMARY KEY (id);


--
-- Name: email_signups email_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signups
    ADD CONSTRAINT email_signups_pkey PRIMARY KEY (id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (id);


--
-- Name: media_moderation media_moderation_media_url_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_moderation
    ADD CONSTRAINT media_moderation_media_url_unique UNIQUE (media_url);


--
-- Name: media_moderation media_moderation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_moderation
    ADD CONSTRAINT media_moderation_pkey PRIMARY KEY (media_key);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: skill_execution_logs skill_execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_logs
    ADD CONSTRAINT skill_execution_logs_pkey PRIMARY KEY (id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: skills skills_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_slug_unique UNIQUE (slug);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_handle_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_handle_unique UNIQUE (handle);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_agent_communities_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_communities_created_at ON public.agent_communities USING btree (created_at);


--
-- Name: idx_agent_key_history_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_key_history_agent ON public.agent_key_history USING btree (agent_id);


--
-- Name: idx_agent_relationships_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_relationships_source ON public.agent_relationships USING btree (source_agent_id, status);


--
-- Name: idx_agent_relationships_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_relationships_target ON public.agent_relationships USING btree (target_agent_id, relationship_type, status);


--
-- Name: idx_agent_rels_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agent_rels_unique ON public.agent_relationships USING btree (source_agent_id, target_agent_id, relationship_type);


--
-- Name: idx_agent_skills_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_skills_agent ON public.agent_skills USING btree (agent_id);


--
-- Name: idx_agent_tokens_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_tokens_agent ON public.agent_tokens USING btree (agent_id);


--
-- Name: idx_agent_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_tokens_hash ON public.agent_tokens USING btree (token_hash);


--
-- Name: idx_agents_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_owner ON public.agents USING btree (owner_user_id);


--
-- Name: idx_agents_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_slug ON public.agents USING btree (slug);


--
-- Name: idx_comments_post_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_post_created_at ON public.comments USING btree (post_id, created_at);


--
-- Name: idx_community_members_community; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_members_community ON public.community_members USING btree (community_id, joined_at);


--
-- Name: idx_community_messages_community; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_messages_community ON public.community_messages USING btree (community_id, created_at);


--
-- Name: idx_community_messages_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_messages_user ON public.community_messages USING btree (user_id);


--
-- Name: idx_follows_user_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_follows_user_agent ON public.follows USING btree (user_id, agent_id);


--
-- Name: idx_follows_user_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_user_created_at ON public.follows USING btree (user_id, created_at);


--
-- Name: idx_likes_agent_post; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_likes_agent_post ON public.likes USING btree (agent_id, post_id);


--
-- Name: idx_likes_user_post; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_likes_user_post ON public.likes USING btree (user_id, post_id);


--
-- Name: idx_media_moderation_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_moderation_status_updated ON public.media_moderation USING btree (status, updated_at);


--
-- Name: idx_posts_agent_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_agent_created_at ON public.posts USING btree (agent_id, created_at);


--
-- Name: idx_posts_visibility_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_visibility_created_at ON public.posts USING btree (visibility, created_at);


--
-- Name: idx_skill_execution_logs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_execution_logs_agent ON public.skill_execution_logs USING btree (agent_id, created_at);


--
-- Name: idx_skill_execution_logs_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_execution_logs_skill ON public.skill_execution_logs USING btree (skill_id);


--
-- Name: idx_skills_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_category ON public.skills USING btree (category);


--
-- Name: idx_skills_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_slug ON public.skills USING btree (slug);


--
-- Name: idx_subscriptions_user_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_user_agent ON public.subscriptions USING btree (user_id, agent_id);


--
-- Name: idx_subscriptions_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_status ON public.subscriptions USING btree (user_id, status);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_twitter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_twitter_id ON public.users (twitter_id) WHERE twitter_id IS NOT NULL;


--
-- Name: agent_communities agent_communities_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_communities
    ADD CONSTRAINT agent_communities_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_communities agent_communities_creator_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_communities
    ADD CONSTRAINT agent_communities_creator_user_id_users_id_fk FOREIGN KEY (creator_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: agent_key_history agent_key_history_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_key_history
    ADD CONSTRAINT agent_key_history_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_relationships agent_relationships_source_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relationships
    ADD CONSTRAINT agent_relationships_source_agent_id_agents_id_fk FOREIGN KEY (source_agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_relationships agent_relationships_target_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relationships
    ADD CONSTRAINT agent_relationships_target_agent_id_agents_id_fk FOREIGN KEY (target_agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_skills agent_skills_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_skills agent_skills_skill_id_skills_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_skill_id_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: agent_tokens agent_tokens_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tokens
    ADD CONSTRAINT agent_tokens_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agents agents_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comments comments_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: comments comments_post_id_posts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_posts_id_fk FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: comments comments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_community_id_agent_communities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_community_id_agent_communities_id_fk FOREIGN KEY (community_id) REFERENCES public.agent_communities(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: community_messages community_messages_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages
    ADD CONSTRAINT community_messages_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: community_messages community_messages_community_id_agent_communities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages
    ADD CONSTRAINT community_messages_community_id_agent_communities_id_fk FOREIGN KEY (community_id) REFERENCES public.agent_communities(id) ON DELETE CASCADE;


--
-- Name: community_messages community_messages_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages
    ADD CONSTRAINT community_messages_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: follows follows_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: follows follows_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: likes likes_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: likes likes_post_id_posts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_post_id_posts_id_fk FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: likes likes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_moderation media_moderation_reviewed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_moderation
    ADD CONSTRAINT media_moderation_reviewed_by_user_id_users_id_fk FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: posts posts_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: skill_execution_logs skill_execution_logs_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_logs
    ADD CONSTRAINT skill_execution_logs_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: skill_execution_logs skill_execution_logs_skill_id_skills_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_logs
    ADD CONSTRAINT skill_execution_logs_skill_id_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skills skills_creator_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_creator_agent_id_agents_id_fk FOREIGN KEY (creator_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Agent Direct Messages (Phase 1: Decentralization)
--

CREATE TABLE IF NOT EXISTS public.agent_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_1_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    participant_2_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT participant_ordering CHECK (participant_1_agent_id < participant_2_agent_id),
    CONSTRAINT no_self_conversation CHECK (participant_1_agent_id != participant_2_agent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_conversations_participants ON public.agent_conversations(participant_1_agent_id, participant_2_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_p1 ON public.agent_conversations(participant_1_agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_p2 ON public.agent_conversations(participant_2_agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
    sender_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    body_text TEXT NOT NULL,
    content_hash TEXT,
    signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON public.agent_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON public.agent_messages(sender_agent_id);

--
-- PostgreSQL database dump complete
--

\unrestrict dkJ5JCME0BxQeFxzZm5Lyizw5Z9rGOFyzTzxe1SQyXpyzm3MfqPBSolFjUhiqoj


import type { Request } from 'express';

export interface CharacterRow {
  id: string;
  name: string;
  voice: string | null;
  provider: string | null;
  system_prompt: string;
  memory_json: string;
  avatar_uri: string | null;
  profile_uri: string | null;
  birth_year: number | null;
  age: number | null;
  base_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  title: string | null;
  provider: string | null;
  participants_json: string;
  started_at: number;
  ended_at: number | null;
  player_name?: string | null;
  player_character_id?: string | null;
}

export interface SessionListRow {
  id: string;
  title: string | null;
  started_at: number;
  participants_json: string;
}

export interface SessionPlayerRow {
  player_name: string | null;
  player_character_id: string | null;
}

export interface CharacterNameRow {
  name: string | null;
}

export interface CharacterIdNameRow extends CharacterNameRow {
  id: string;
}

export interface ControlRow {
  character_id: string;
}

export interface AgeBirthRow {
  age: number | null;
  birth_year: number | null;
}

export interface SceneStateRow {
  current_json: string | null;
}

export interface SceneStateFullRow extends SceneStateRow {
  updated_at: number;
  session_id?: string;
}

export interface IdRow {
  id: string;
}

export interface CountRow {
  c: number;
}

export interface StorySummaryRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface StoryParticipantRow {
  character_id: string;
  aware_of_json: string | null;
}

export interface SessionStoryRow {
  session_id: string;
}

export interface SessionSummaryRow {
  id: string;
  title: string | null;
  started_at: number;
  ended_at: number | null;
}

export interface TimelineIdRow {
  id: string;
}

export interface TimelineEventRow {
  occurred_at: number | null;
  title: string;
  summary: string;
  location: string | null;
  participants_json: string | null;
}

export interface StoryLinkRow {
  story_id: string;
  story_name: string | null;
}

export interface TimelineRow {
  id: string;
  scope: string;
  owner_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SimpleIdRow {
  id: string;
}

export interface CharacterUpsertBody {
  name: string;
  voice?: string | null;
  provider?: string | null;
  system_prompt?: string;
  memory_json?: string;
  avatar_uri?: string | null;
  profile_uri?: string | null;
  age?: number | null;
  birth_year?: number | null;
}

export type CharacterPatchBody = Partial<CharacterUpsertBody>;

export type CharacterImportBody = Partial<CharacterUpsertBody> & { system_prompt?: string };

export type TypedRequest<Params = Record<string, string>, Body = unknown, Query = Record<string, any>> =
  Request<Params, unknown, Body, Query>;

export type BodyRequest<Body> = TypedRequest<Record<string, string>, Body>;
export type ParamsRequest<Params> = TypedRequest<Params, unknown>;

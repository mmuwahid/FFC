export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_profile_id: string
          created_at: string
          id: string
          payload_jsonb: Json
          target_entity: string
          target_id: string | null
        }
        Insert: {
          action: string
          admin_profile_id: string
          created_at?: string
          id?: string
          payload_jsonb?: Json
          target_entity: string
          target_id?: string | null
        }
        Update: {
          action?: string
          admin_profile_id?: string
          created_at?: string
          id?: string
          payload_jsonb?: Json
          target_entity?: string
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_profile_id_fkey"
            columns: ["admin_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          draft_session_id: string
          guest_id: string | null
          id: string
          pick_order: number
          picked_at: string
          profile_id: string | null
          team: Database["public"]["Enums"]["team_color"]
        }
        Insert: {
          draft_session_id: string
          guest_id?: string | null
          id?: string
          pick_order: number
          picked_at?: string
          profile_id?: string | null
          team: Database["public"]["Enums"]["team_color"]
        }
        Update: {
          draft_session_id?: string
          guest_id?: string | null
          id?: string
          pick_order?: number
          picked_at?: string
          profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"]
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_draft_session_id_fkey"
            columns: ["draft_session_id"]
            isOneToOne: false
            referencedRelation: "draft_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_sessions: {
        Row: {
          completed_at: string | null
          current_picker_team: Database["public"]["Enums"]["team_color"]
          id: string
          matchday_id: string
          reason: Database["public"]["Enums"]["draft_reason"]
          started_at: string
          status: Database["public"]["Enums"]["draft_status"]
          triggered_by_profile_id: string | null
        }
        Insert: {
          completed_at?: string | null
          current_picker_team?: Database["public"]["Enums"]["team_color"]
          id?: string
          matchday_id: string
          reason?: Database["public"]["Enums"]["draft_reason"]
          started_at?: string
          status?: Database["public"]["Enums"]["draft_status"]
          triggered_by_profile_id?: string | null
        }
        Update: {
          completed_at?: string | null
          current_picker_team?: Database["public"]["Enums"]["team_color"]
          id?: string
          matchday_id?: string
          reason?: Database["public"]["Enums"]["draft_reason"]
          started_at?: string
          status?: Database["public"]["Enums"]["draft_status"]
          triggered_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_sessions_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_sessions_triggered_by_profile_id_fkey"
            columns: ["triggered_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      formations: {
        Row: {
          created_at: string
          formation_rotation_order: Json | null
          id: string
          last_edited_at: string
          last_edited_by: string | null
          layout_jsonb: Json
          matchday_id: string
          notes: string | null
          pattern: string
          shared_at: string | null
          starting_gk_profile_id: string | null
          team: Database["public"]["Enums"]["team_color"]
        }
        Insert: {
          created_at?: string
          formation_rotation_order?: Json | null
          id?: string
          last_edited_at?: string
          last_edited_by?: string | null
          layout_jsonb: Json
          matchday_id: string
          notes?: string | null
          pattern: string
          shared_at?: string | null
          starting_gk_profile_id?: string | null
          team: Database["public"]["Enums"]["team_color"]
        }
        Update: {
          created_at?: string
          formation_rotation_order?: Json | null
          id?: string
          last_edited_at?: string
          last_edited_by?: string | null
          layout_jsonb?: Json
          matchday_id?: string
          notes?: string | null
          pattern?: string
          shared_at?: string | null
          starting_gk_profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"]
        }
        Relationships: [
          {
            foreignKeyName: "formations_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formations_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formations_starting_gk_profile_id_fkey"
            columns: ["starting_gk_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          guest_id: string | null
          id: string
          match_id: string
          match_minute: number
          match_second: number
          meta: Json
          ordinal: number
          profile_id: string | null
          team: Database["public"]["Enums"]["team_color"] | null
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          guest_id?: string | null
          id?: string
          match_id: string
          match_minute: number
          match_second?: number
          meta?: Json
          ordinal: number
          profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"] | null
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["match_event_type"]
          guest_id?: string | null
          id?: string
          match_id?: string
          match_minute?: number
          match_second?: number
          meta?: Json
          ordinal?: number
          profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"] | null
        }
        Relationships: [
          {
            foreignKeyName: "match_events_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "v_player_last5"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_guests: {
        Row: {
          accuracy: Database["public"]["Enums"]["guest_trait"] | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          inviter_id: string
          matchday_id: string
          primary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          rating: Database["public"]["Enums"]["guest_rating"] | null
          secondary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          stamina: Database["public"]["Enums"]["guest_trait"] | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          accuracy?: Database["public"]["Enums"]["guest_trait"] | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          inviter_id: string
          matchday_id: string
          primary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          rating?: Database["public"]["Enums"]["guest_rating"] | null
          secondary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          stamina?: Database["public"]["Enums"]["guest_trait"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          accuracy?: Database["public"]["Enums"]["guest_trait"] | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          inviter_id?: string
          matchday_id?: string
          primary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          rating?: Database["public"]["Enums"]["guest_rating"] | null
          secondary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          stamina?: Database["public"]["Enums"]["guest_trait"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_guests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_guests_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_guests_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_guests_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_players: {
        Row: {
          created_at: string
          goals: number
          guest_id: string | null
          id: string
          is_captain: boolean
          is_no_show: boolean
          match_id: string
          profile_id: string | null
          red_cards: number
          substituted_in_by: string | null
          team: Database["public"]["Enums"]["team_color"]
          updated_at: string
          updated_by: string | null
          yellow_cards: number
        }
        Insert: {
          created_at?: string
          goals?: number
          guest_id?: string | null
          id?: string
          is_captain?: boolean
          is_no_show?: boolean
          match_id: string
          profile_id?: string | null
          red_cards?: number
          substituted_in_by?: string | null
          team: Database["public"]["Enums"]["team_color"]
          updated_at?: string
          updated_by?: string | null
          yellow_cards?: number
        }
        Update: {
          created_at?: string
          goals?: number
          guest_id?: string | null
          id?: string
          is_captain?: boolean
          is_no_show?: boolean
          match_id?: string
          profile_id?: string | null
          red_cards?: number
          substituted_in_by?: string | null
          team?: Database["public"]["Enums"]["team_color"]
          updated_at?: string
          updated_by?: string | null
          yellow_cards?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_players_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "v_player_last5"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_substituted_in_by_fkey"
            columns: ["substituted_in_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matchdays: {
        Row: {
          created_at: string
          created_by: string | null
          format: Database["public"]["Enums"]["match_format"] | null
          friendly_flagged_at: string | null
          id: string
          is_friendly: boolean
          kickoff_at: string
          poll_closes_at: string
          poll_opens_at: string
          roster_locked_at: string | null
          season_id: string
          venue: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          format?: Database["public"]["Enums"]["match_format"] | null
          friendly_flagged_at?: string | null
          id?: string
          is_friendly?: boolean
          kickoff_at: string
          poll_closes_at: string
          poll_opens_at: string
          roster_locked_at?: string | null
          season_id: string
          venue?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          format?: Database["public"]["Enums"]["match_format"] | null
          friendly_flagged_at?: string | null
          id?: string
          is_friendly?: boolean
          kickoff_at?: string
          poll_closes_at?: string
          poll_opens_at?: string
          roster_locked_at?: string | null
          season_id?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matchdays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchdays_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          fulltime_at: string | null
          halftime_at: string | null
          id: string
          kickoff_at: string | null
          matchday_id: string
          motm_guest_id: string | null
          motm_user_id: string | null
          notes: string | null
          result: Database["public"]["Enums"]["match_result"] | null
          score_black: number | null
          score_white: number | null
          season_id: string
          stoppage_h1_seconds: number | null
          stoppage_h2_seconds: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          fulltime_at?: string | null
          halftime_at?: string | null
          id?: string
          kickoff_at?: string | null
          matchday_id: string
          motm_guest_id?: string | null
          motm_user_id?: string | null
          notes?: string | null
          result?: Database["public"]["Enums"]["match_result"] | null
          score_black?: number | null
          score_white?: number | null
          season_id: string
          stoppage_h1_seconds?: number | null
          stoppage_h2_seconds?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          fulltime_at?: string | null
          halftime_at?: string | null
          id?: string
          kickoff_at?: string | null
          matchday_id?: string
          motm_guest_id?: string | null
          motm_user_id?: string | null
          notes?: string | null
          result?: Database["public"]["Enums"]["match_result"] | null
          score_black?: number | null
          score_white?: number | null
          season_id?: string
          stoppage_h1_seconds?: number | null
          stoppage_h2_seconds?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: true
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_motm_guest_id_fkey"
            columns: ["motm_guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_motm_user_id_fkey"
            columns: ["motm_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          dispatched_push_at: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json
          push_error: string | null
          read_at: string | null
          recipient_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          dispatched_push_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          push_error?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          dispatched_push_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          push_error?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_match_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          fulltime_at: string | null
          halftime_at: string | null
          id: string
          kickoff_at: string | null
          matchday_id: string
          notes: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          result: Database["public"]["Enums"]["match_result"]
          score_black: number
          score_white: number
          status: Database["public"]["Enums"]["pending_match_status"]
          stoppage_h1_seconds: number
          stoppage_h2_seconds: number
          submitted_at: string
          submitted_by_token_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          fulltime_at?: string | null
          halftime_at?: string | null
          id?: string
          kickoff_at?: string | null
          matchday_id: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          result: Database["public"]["Enums"]["match_result"]
          score_black: number
          score_white: number
          status?: Database["public"]["Enums"]["pending_match_status"]
          stoppage_h1_seconds?: number
          stoppage_h2_seconds?: number
          submitted_at?: string
          submitted_by_token_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          fulltime_at?: string | null
          halftime_at?: string | null
          id?: string
          kickoff_at?: string | null
          matchday_id?: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          result?: Database["public"]["Enums"]["match_result"]
          score_black?: number
          score_white?: number
          status?: Database["public"]["Enums"]["pending_match_status"]
          stoppage_h1_seconds?: number
          stoppage_h2_seconds?: number
          submitted_at?: string
          submitted_by_token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_match_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_entries_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_entries_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_entries_submitted_by_token_id_fkey"
            columns: ["submitted_by_token_id"]
            isOneToOne: false
            referencedRelation: "ref_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_match_entry_players: {
        Row: {
          goals: number
          guest_id: string | null
          id: string
          is_motm: boolean
          pending_entry_id: string
          profile_id: string | null
          red_cards: number
          team: Database["public"]["Enums"]["team_color"]
          yellow_cards: number
        }
        Insert: {
          goals?: number
          guest_id?: string | null
          id?: string
          is_motm?: boolean
          pending_entry_id: string
          profile_id?: string | null
          red_cards?: number
          team: Database["public"]["Enums"]["team_color"]
          yellow_cards?: number
        }
        Update: {
          goals?: number
          guest_id?: string | null
          id?: string
          is_motm?: boolean
          pending_entry_id?: string
          profile_id?: string | null
          red_cards?: number
          team?: Database["public"]["Enums"]["team_color"]
          yellow_cards?: number
        }
        Relationships: [
          {
            foreignKeyName: "pending_match_entry_players_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_entry_players_pending_entry_id_fkey"
            columns: ["pending_entry_id"]
            isOneToOne: false
            referencedRelation: "pending_match_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_entry_players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_match_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          guest_id: string | null
          id: string
          match_minute: number
          match_second: number
          meta: Json
          ordinal: number
          pending_entry_id: string
          profile_id: string | null
          team: Database["public"]["Enums"]["team_color"] | null
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          guest_id?: string | null
          id?: string
          match_minute: number
          match_second?: number
          meta?: Json
          ordinal: number
          pending_entry_id: string
          profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"] | null
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["match_event_type"]
          guest_id?: string | null
          id?: string
          match_minute?: number
          match_second?: number
          meta?: Json
          ordinal?: number
          pending_entry_id?: string
          profile_id?: string | null
          team?: Database["public"]["Enums"]["team_color"] | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_match_events_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "match_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_events_pending_entry_id_fkey"
            columns: ["pending_entry_id"]
            isOneToOne: false
            referencedRelation: "pending_match_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_match_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_signups: {
        Row: {
          auth_user_id: string
          claim_profile_hint: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          message: string | null
          phone: string | null
          rejection_reason: string | null
          resolution: Database["public"]["Enums"]["signup_resolution"]
          resolved_at: string | null
          resolved_by: string | null
          resolved_profile_id: string | null
        }
        Insert: {
          auth_user_id: string
          claim_profile_hint?: string | null
          created_at?: string
          display_name: string
          email: string
          id?: string
          message?: string | null
          phone?: string | null
          rejection_reason?: string | null
          resolution?: Database["public"]["Enums"]["signup_resolution"]
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_profile_id?: string | null
        }
        Update: {
          auth_user_id?: string
          claim_profile_hint?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          message?: string | null
          phone?: string | null
          rejection_reason?: string | null
          resolution?: Database["public"]["Enums"]["signup_resolution"]
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_signups_claim_profile_hint_fkey"
            columns: ["claim_profile_hint"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_signups_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_signups_resolved_profile_id_fkey"
            columns: ["resolved_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_bans: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          imposed_by: string
          profile_id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          imposed_by: string
          profile_id: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          imposed_by?: string
          profile_id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_bans_imposed_by_fkey"
            columns: ["imposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_bans_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_bans_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          choice: Database["public"]["Enums"]["poll_choice"]
          committed_at: string
          created_at: string
          id: string
          matchday_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          choice: Database["public"]["Enums"]["poll_choice"]
          committed_at?: string
          created_at?: string
          id?: string
          matchday_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          choice?: Database["public"]["Enums"]["poll_choice"]
          committed_at?: string
          created_at?: string
          id?: string
          matchday_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          joined_on: string
          leaderboard_sort: Database["public"]["Enums"]["leaderboard_sort"]
          notes: string | null
          phone: string | null
          primary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          push_prefs: Json
          reject_reason: string | null
          role: Database["public"]["Enums"]["user_role"]
          secondary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          joined_on?: string
          leaderboard_sort?: Database["public"]["Enums"]["leaderboard_sort"]
          notes?: string | null
          phone?: string | null
          primary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          push_prefs?: Json
          reject_reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          secondary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          joined_on?: string
          leaderboard_sort?: Database["public"]["Enums"]["leaderboard_sort"]
          notes?: string | null
          phone?: string | null
          primary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          push_prefs?: Json
          reject_reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          secondary_position?:
            | Database["public"]["Enums"]["player_position"]
            | null
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_tokens: {
        Row: {
          consumed_at: string | null
          expires_at: string
          id: string
          issued_at: string
          issued_by: string
          label: string | null
          matchday_id: string
          token_sha256: string
        }
        Insert: {
          consumed_at?: string | null
          expires_at: string
          id?: string
          issued_at?: string
          issued_by: string
          label?: string | null
          matchday_id: string
          token_sha256: string
        }
        Update: {
          consumed_at?: string | null
          expires_at?: string
          id?: string
          issued_at?: string
          issued_by?: string
          label?: string | null
          matchday_id?: string
          token_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_tokens_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_tokens_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_reminders: {
        Row: {
          channels: Database["public"]["Enums"]["reminder_channel"][]
          created_at: string
          created_by: string
          cron_expression: string
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          label: string
          last_fire_status: string | null
          last_fired_at: string | null
          payload_template: Json
          target_audience: string
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          created_by: string
          cron_expression: string
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          label: string
          last_fire_status?: string | null
          last_fired_at?: string | null
          payload_template?: Json
          target_audience?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          created_by?: string
          cron_expression?: string
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["reminder_kind"]
          label?: string
          last_fire_status?: string | null
          last_fired_at?: string | null
          payload_template?: Json
          target_audience?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reminders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      season_seed_stats: {
        Row: {
          created_at: string
          draws_seed: number
          goals_seed: number
          late_cancel_points_seed: number
          losses_seed: number
          motms_seed: number
          no_show_points_seed: number
          profile_id: string
          reds_seed: number
          season_id: string
          updated_at: string
          wins_seed: number
          yellows_seed: number
        }
        Insert: {
          created_at?: string
          draws_seed?: number
          goals_seed?: number
          late_cancel_points_seed?: number
          losses_seed?: number
          motms_seed?: number
          no_show_points_seed?: number
          profile_id: string
          reds_seed?: number
          season_id: string
          updated_at?: string
          wins_seed?: number
          yellows_seed?: number
        }
        Update: {
          created_at?: string
          draws_seed?: number
          goals_seed?: number
          late_cancel_points_seed?: number
          losses_seed?: number
          motms_seed?: number
          no_show_points_seed?: number
          profile_id?: string
          reds_seed?: number
          season_id?: string
          updated_at?: string
          wins_seed?: number
          yellows_seed?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_seed_stats_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_seed_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          default_format: Database["public"]["Enums"]["match_format"]
          ended_at: string | null
          ended_by: string | null
          ends_on: string | null
          id: string
          name: string
          planned_games: number | null
          roster_policy: Database["public"]["Enums"]["roster_policy"]
          starts_on: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          default_format?: Database["public"]["Enums"]["match_format"]
          ended_at?: string | null
          ended_by?: string | null
          ends_on?: string | null
          id?: string
          name: string
          planned_games?: number | null
          roster_policy?: Database["public"]["Enums"]["roster_policy"]
          starts_on: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          default_format?: Database["public"]["Enums"]["match_format"]
          ended_at?: string | null
          ended_by?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          planned_games?: number | null
          roster_policy?: Database["public"]["Enums"]["roster_policy"]
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_captain_eligibility: {
        Row: {
          attendance_rate: number | null
          cooldown_ok: boolean | null
          display_name: string | null
          is_eligible: boolean | null
          matchdays_since_captained: number | null
          matches_played: number | null
          meets_attendance: boolean | null
          meets_min_matches: boolean | null
          motms: number | null
          points: number | null
          profile_id: string | null
          season_id: string | null
        }
        Relationships: []
      }
      v_match_commitments: {
        Row: {
          commitment_type: string | null
          guest_display_name: string | null
          guest_id: string | null
          inviter_id: string | null
          matchday_id: string | null
          participant_id: string | null
          slot_order: number | null
          sort_ts: string | null
        }
        Relationships: []
      }
      v_player_last5: {
        Row: {
          kickoff_at: string | null
          match_id: string | null
          outcome: string | null
          profile_id: string | null
          rn: number | null
          season_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      v_season_standings: {
        Row: {
          display_name: string | null
          draws: number | null
          goals: number | null
          late_cancel_points: number | null
          losses: number | null
          motms: number | null
          no_show_points: number | null
          points: number | null
          profile_id: string | null
          reds: number | null
          season_id: string | null
          wins: number | null
          yellows: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_substitute: { Args: { p_matchday_id: string }; Returns: undefined }
      admin_draft_abandon: {
        Args: { p_matchday_id: string; p_reason?: string }
        Returns: string
      }
      admin_draft_force_complete: {
        Args: { p_matchday_id: string; p_reason?: string }
        Returns: string
      }
      admin_submit_match_result: {
        Args: {
          p_approve?: boolean
          p_matchday_id: string
          p_motm_guest_id: string
          p_motm_profile_id: string
          p_notes?: string
          p_players: Json
          p_score_black: number
          p_score_white: number
        }
        Returns: string
      }
      approve_match_entry: {
        Args: { p_edits?: Json; p_pending_id: string }
        Returns: string
      }
      approve_signup: {
        Args: { p_claim_profile_id?: string; p_pending_id: string }
        Returns: string
      }
      archive_season: { Args: { p_season_id: string }; Returns: undefined }
      ban_player: {
        Args: { p_ends_at: string; p_profile_id: string; p_reason: string }
        Returns: string
      }
      cast_poll_vote: {
        Args: { p_choice: string; p_matchday_id: string }
        Returns: Json
      }
      confirm_friendly_matchday: {
        Args: { p_matchday_id: string }
        Returns: undefined
      }
      create_match_draft: {
        Args: {
          p_black_guests: string[]
          p_black_roster: string[]
          p_matchday_id: string
          p_white_guests: string[]
          p_white_roster: string[]
        }
        Returns: string
      }
      create_matchday: {
        Args: {
          p_format?: Database["public"]["Enums"]["match_format"]
          p_kickoff_at: string
          p_poll_closes_at: string
          p_poll_opens_at: string
          p_season_id: string
          p_venue: string
        }
        Returns: string
      }
      create_season: {
        Args: {
          p_default_format?: Database["public"]["Enums"]["match_format"]
          p_name: string
          p_planned_games: number
          p_roster_policy?: Database["public"]["Enums"]["roster_policy"]
          p_starts_on: string
        }
        Returns: string
      }
      current_profile_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      delete_season: { Args: { p_season_id: string }; Returns: undefined }
      demote_admin: { Args: { p_profile_id: string }; Returns: undefined }
      dismiss_friendly_flag: {
        Args: { p_matchday_id: string }
        Returns: undefined
      }
      edit_match_players: {
        Args: { p_match_id: string; p_players: Json }
        Returns: Json
      }
      edit_match_result: {
        Args: { p_edits: Json; p_match_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          fulltime_at: string | null
          halftime_at: string | null
          id: string
          kickoff_at: string | null
          matchday_id: string
          motm_guest_id: string | null
          motm_user_id: string | null
          notes: string | null
          result: Database["public"]["Enums"]["match_result"] | null
          score_black: number | null
          score_white: number | null
          season_id: string
          stoppage_h1_seconds: number | null
          stoppage_h2_seconds: number | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      effective_format: {
        Args: { p_matchday_id: string }
        Returns: Database["public"]["Enums"]["match_format"]
      }
      fire_due_reminders: { Args: never; Returns: undefined }
      fire_scheduled_reminder: {
        Args: { p_reminder_id: string }
        Returns: undefined
      }
      invite_guest: {
        Args: {
          p_accuracy: Database["public"]["Enums"]["guest_trait"]
          p_description: string
          p_display_name: string
          p_matchday_id: string
          p_primary_position: Database["public"]["Enums"]["player_position"]
          p_rating: Database["public"]["Enums"]["guest_rating"]
          p_secondary_position: Database["public"]["Enums"]["player_position"]
          p_stamina: Database["public"]["Enums"]["guest_trait"]
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      lock_roster: { Args: { p_matchday_id: string }; Returns: undefined }
      log_admin_action: {
        Args: {
          p_action: string
          p_payload?: Json
          p_target_entity: string
          p_target_id: string
        }
        Returns: undefined
      }
      pick_captains_random: {
        Args: { p_matchday_id: string }
        Returns: {
          black_captain: string
          white_captain: string
        }[]
      }
      promote_admin: { Args: { p_profile_id: string }; Returns: undefined }
      promote_from_waitlist: {
        Args: { p_departing_profile: string; p_matchday_id: string }
        Returns: string
      }
      record_no_shows: {
        Args: { p_match_id: string; p_profile_ids: string[] }
        Returns: undefined
      }
      regenerate_ref_token: { Args: { p_matchday_id: string }; Returns: string }
      reinstate_rejected: { Args: { p_profile_id: string }; Returns: undefined }
      reject_match_entry: {
        Args: { p_pending_id: string; p_reason: string }
        Returns: undefined
      }
      reject_signup: {
        Args: { p_pending_id: string; p_reason: string }
        Returns: undefined
      }
      request_reroll: { Args: { p_matchday_id: string }; Returns: string }
      roster_cap: {
        Args: { p_format: Database["public"]["Enums"]["match_format"] }
        Returns: number
      }
      set_matchday_captains: {
        Args: {
          p_black_profile_id: string
          p_matchday_id: string
          p_white_profile_id: string
        }
        Returns: {
          assigned_at: string
          black_captain: string
          white_captain: string
        }[]
      }
      share_formation: { Args: { p_formation_id: string }; Returns: undefined }
      submit_draft_pick: {
        Args: {
          p_draft_session_id: string
          p_guest_id?: string
          p_profile_id?: string
        }
        Returns: {
          draft_session_id: string
          guest_id: string | null
          id: string
          pick_order: number
          picked_at: string
          profile_id: string | null
          team: Database["public"]["Enums"]["team_color"]
        }
        SetofOptions: {
          from: "*"
          to: "draft_picks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_ref_entry: {
        Args: { p_payload: Json; p_token: string }
        Returns: string
      }
      suggest_captain_pairs: {
        Args: { p_matchday_id: string }
        Returns: {
          black_captain: string
          score: number
          white_captain: string
        }[]
      }
      unban_player: { Args: { p_profile_id: string }; Returns: undefined }
      update_guest_stats: {
        Args: {
          p_accuracy: Database["public"]["Enums"]["guest_trait"]
          p_description: string
          p_guest_id: string
          p_primary_position: Database["public"]["Enums"]["player_position"]
          p_rating: Database["public"]["Enums"]["guest_rating"]
          p_secondary_position: Database["public"]["Enums"]["player_position"]
          p_stamina: Database["public"]["Enums"]["guest_trait"]
        }
        Returns: {
          accuracy: Database["public"]["Enums"]["guest_trait"] | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          inviter_id: string
          matchday_id: string
          primary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          rating: Database["public"]["Enums"]["guest_rating"] | null
          secondary_position:
            | Database["public"]["Enums"]["player_position"]
            | null
          stamina: Database["public"]["Enums"]["guest_trait"] | null
          updated_at: string | null
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "match_guests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_matchday: {
        Args: {
          p_format?: Database["public"]["Enums"]["match_format"]
          p_format_explicit_null?: boolean
          p_kickoff_at?: string
          p_matchday_id: string
          p_poll_closes_at?: string
          p_poll_opens_at?: string
          p_venue?: string
          p_venue_explicit_null?: boolean
        }
        Returns: undefined
      }
      update_player_profile: {
        Args: {
          p_display_name: string
          p_is_active: boolean
          p_primary_position: Database["public"]["Enums"]["player_position"]
          p_profile_id: string
          p_role?: Database["public"]["Enums"]["user_role"]
          p_secondary_position: Database["public"]["Enums"]["player_position"]
        }
        Returns: undefined
      }
      update_season: {
        Args: {
          p_clear_ends_on?: boolean
          p_default_format?: Database["public"]["Enums"]["match_format"]
          p_ends_on?: string
          p_name?: string
          p_planned_games?: number
          p_roster_policy?: Database["public"]["Enums"]["roster_policy"]
          p_season_id: string
          p_starts_on?: string
        }
        Returns: undefined
      }
      update_season_planned_games: {
        Args: { p_planned_games?: number; p_season_id: string }
        Returns: undefined
      }
      upsert_formation: {
        Args: {
          p_layout_jsonb: Json
          p_matchday_id: string
          p_notes?: string
          p_pattern: string
          p_rotation_order?: Json
          p_starting_gk_profile_id?: string
          p_team: Database["public"]["Enums"]["team_color"]
        }
        Returns: string
      }
    }
    Enums: {
      draft_reason: "initial" | "reroll_after_dropout"
      draft_status: "in_progress" | "completed" | "abandoned"
      guest_rating: "weak" | "average" | "strong"
      guest_trait: "low" | "medium" | "high"
      leaderboard_sort: "points" | "goals" | "motm" | "wins" | "last5_form"
      match_event_type:
        | "goal"
        | "own_goal"
        | "yellow_card"
        | "red_card"
        | "halftime"
        | "fulltime"
        | "pause"
        | "resume"
      match_format: "7v7" | "5v5"
      match_result: "win_white" | "win_black" | "draw"
      notification_kind:
        | "poll_open"
        | "poll_reminder"
        | "roster_locked"
        | "teams_posted"
        | "plus_one_unlocked"
        | "plus_one_slot_taken"
        | "match_entry_submitted"
        | "match_entry_approved"
        | "match_entry_rejected"
        | "signup_approved"
        | "signup_rejected"
        | "admin_promoted"
        | "season_archived"
        | "dropout_after_lock"
        | "draft_reroll_started"
        | "reroll_triggered_by_opponent"
        | "captain_dropout_needs_replacement"
        | "formation_reminder"
        | "formation_shared"
      pending_match_status: "pending" | "approved" | "rejected"
      player_position: "GK" | "DEF" | "CDM" | "W" | "ST"
      poll_choice: "yes" | "no" | "maybe"
      reminder_channel: "push" | "email" | "whatsapp_share"
      reminder_kind:
        | "poll_open_broadcast"
        | "poll_cutoff_warning"
        | "plus_one_unlock_broadcast"
        | "teams_post_reminder"
        | "custom"
      roster_policy: "fresh" | "carry_forward"
      season_status: "active" | "ended" | "archived"
      signup_resolution: "pending" | "approved" | "rejected"
      team_color: "white" | "black"
      theme_preference: "light" | "dark" | "system"
      user_role: "player" | "admin" | "super_admin" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      draft_reason: ["initial", "reroll_after_dropout"],
      draft_status: ["in_progress", "completed", "abandoned"],
      guest_rating: ["weak", "average", "strong"],
      guest_trait: ["low", "medium", "high"],
      leaderboard_sort: ["points", "goals", "motm", "wins", "last5_form"],
      match_event_type: [
        "goal",
        "own_goal",
        "yellow_card",
        "red_card",
        "halftime",
        "fulltime",
        "pause",
        "resume",
      ],
      match_format: ["7v7", "5v5"],
      match_result: ["win_white", "win_black", "draw"],
      notification_kind: [
        "poll_open",
        "poll_reminder",
        "roster_locked",
        "teams_posted",
        "plus_one_unlocked",
        "plus_one_slot_taken",
        "match_entry_submitted",
        "match_entry_approved",
        "match_entry_rejected",
        "signup_approved",
        "signup_rejected",
        "admin_promoted",
        "season_archived",
        "dropout_after_lock",
        "draft_reroll_started",
        "reroll_triggered_by_opponent",
        "captain_dropout_needs_replacement",
        "formation_reminder",
        "formation_shared",
      ],
      pending_match_status: ["pending", "approved", "rejected"],
      player_position: ["GK", "DEF", "CDM", "W", "ST"],
      poll_choice: ["yes", "no", "maybe"],
      reminder_channel: ["push", "email", "whatsapp_share"],
      reminder_kind: [
        "poll_open_broadcast",
        "poll_cutoff_warning",
        "plus_one_unlock_broadcast",
        "teams_post_reminder",
        "custom",
      ],
      roster_policy: ["fresh", "carry_forward"],
      season_status: ["active", "ended", "archived"],
      signup_resolution: ["pending", "approved", "rejected"],
      team_color: ["white", "black"],
      theme_preference: ["light", "dark", "system"],
      user_role: ["player", "admin", "super_admin", "rejected"],
    },
  },
} as const

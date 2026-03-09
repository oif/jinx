/**
 * Tests for Self-Challenge Module
 * 
 * Tests the utility functions and type guards in src/self-challenge/types.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isChallengeTask,
  createChallengeFromBacklog,
  formatChallengeTask,
  DEFAULT_VERIFICATION_CONDITIONS,
  type ChallengeTask,
  type ChallengeCategory,
  type VerificationCondition,
} from '../src/self-challenge/types.js';

describe('Self-Challenge Types', () => {
  describe('isChallengeTask', () => {
    it('should return true for valid ChallengeTask', () => {
      const validTask: ChallengeTask = {
        id: '#001',
        title: 'Test Task',
        category: 'capability_gap',
        difficulty: 'medium',
        instruction: 'Do something',
        verificationConditions: [
          {
            description: 'Tests pass',
            type: 'test',
            expectedOutcome: 'All tests pass',
          },
        ],
        exampleApproach: 'Example approach',
        failureCases: ['Test fails'],
        dependencyValue: 'High value',
        createdAt: '2026-03-09T00:00:00.000Z',
        source: 'self_challenge',
      };

      expect(isChallengeTask(validTask)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isChallengeTask(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isChallengeTask(undefined)).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect(isChallengeTask('string')).toBe(false);
      expect(isChallengeTask(123)).toBe(false);
      expect(isChallengeTask(true)).toBe(false);
    });

    it('should return false for object missing required fields', () => {
      expect(isChallengeTask({})).toBe(false);
      expect(isChallengeTask({ id: '#001' })).toBe(false);
      expect(isChallengeTask({ id: '#001', title: 'Test' })).toBe(false);
    });

    it('should return false for object with wrong field types', () => {
      const invalidTask = {
        id: '#001',
        title: 'Test Task',
        category: 'capability_gap',
        difficulty: 'medium',
        instruction: 'Do something',
        verificationConditions: 'not an array', // Wrong type
        exampleApproach: 'Example approach',
        failureCases: ['Test fails'],
      };

      expect(isChallengeTask(invalidTask)).toBe(false);
    });

    it('should return true for minimal valid task', () => {
      const minimalTask = {
        id: '#002',
        title: 'Minimal Task',
        category: 'experience_mining' as ChallengeCategory,
        difficulty: 'easy',
        instruction: 'Quick task',
        verificationConditions: [],
        exampleApproach: '',
        failureCases: [],
      };

      expect(isChallengeTask(minimalTask)).toBe(true);
    });
  });

  describe('createChallengeFromBacklog', () => {
    it('should create a challenge task with default values', () => {
      const task = createChallengeFromBacklog('#100', 'Fix bug in evolution loop');

      expect(task.id).toBe('#100');
      expect(task.title).toBe('Fix bug in evolution loop');
      expect(task.category).toBe('capability_gap');
      expect(task.difficulty).toBe('medium');
      expect(task.instruction).toBe('Fix bug in evolution loop');
      expect(task.verificationConditions).toEqual(DEFAULT_VERIFICATION_CONDITIONS.code_change);
      expect(task.exampleApproach).toBe('To be determined during implementation');
      expect(task.failureCases).toContain('Tests fail');
      expect(task.dependencyValue).toBe('To be assessed');
      expect(task.source).toBe('external');
    });

    it('should create a challenge with specified category', () => {
      const task = createChallengeFromBacklog('#101', 'Research task', 'external_discovery');

      expect(task.category).toBe('external_discovery');
    });

    it('should create a challenge with experience_mining category', () => {
      const task = createChallengeFromBacklog('#102', 'Mining task', 'experience_mining');

      expect(task.category).toBe('experience_mining');
    });

    it('should have valid createdAt timestamp', () => {
      const before = new Date().toISOString();
      const task = createChallengeFromBacklog('#103', 'Test');
      const after = new Date().toISOString();

      expect(task.createdAt >= before).toBe(true);
      expect(task.createdAt <= after).toBe(true);
    });
  });

  describe('formatChallengeTask', () => {
    it('should format a challenge task for display', () => {
      const task: ChallengeTask = {
        id: '#050',
        title: 'Test Feature',
        category: 'capability_gap',
        difficulty: 'hard',
        instruction: 'Implement a new feature',
        verificationConditions: [
          {
            description: 'Tests pass',
            type: 'test',
            checkCommand: 'pnpm test',
            expectedOutcome: 'All tests pass',
          },
        ],
        exampleApproach: 'Start with the core logic',
        failureCases: ['Build fails', 'Tests fail'],
        dependencyValue: 'High priority',
        createdAt: '2026-03-09T00:00:00.000Z',
        source: 'self_challenge',
      };

      const formatted = formatChallengeTask(task);

      expect(formatted).toContain('### Challenge #050: Test Feature');
      expect(formatted).toContain('**Category**: capability_gap');
      expect(formatted).toContain('**Difficulty**: hard');
      expect(formatted).toContain('Implement a new feature');
      expect(formatted).toContain('Tests pass');
      expect(formatted).toContain('`pnpm test`');
      expect(formatted).toContain('Start with the core logic');
      expect(formatted).toContain('Build fails');
      expect(formatted).toContain('High priority');
    });

    it('should handle task without checkCommand', () => {
      const task: ChallengeTask = {
        id: '#051',
        title: 'Manual Task',
        category: 'external_discovery',
        difficulty: 'easy',
        instruction: 'Manual verification',
        verificationConditions: [
          {
            description: 'Manual check',
            type: 'functional',
            expectedOutcome: 'Works as expected',
          },
        ],
        exampleApproach: 'Do it manually',
        failureCases: [],
        dependencyValue: 'Low',
        createdAt: '2026-03-09T00:00:00.000Z',
        source: 'external',
      };

      const formatted = formatChallengeTask(task);

      expect(formatted).toContain('- [ ] Manual check');
      expect(formatted).not.toContain('`');
    });

    it('should format multiple failure cases with numbers', () => {
      const task: ChallengeTask = {
        id: '#052',
        title: 'Multi-failure Task',
        category: 'capability_gap',
        difficulty: 'medium',
        instruction: 'Test instruction',
        verificationConditions: [],
        exampleApproach: 'Approach',
        failureCases: ['First failure', 'Second failure', 'Third failure'],
        dependencyValue: 'Medium',
        createdAt: '2026-03-09T00:00:00.000Z',
        source: 'self_challenge',
      };

      const formatted = formatChallengeTask(task);

      expect(formatted).toContain('1. First failure');
      expect(formatted).toContain('2. Second failure');
      expect(formatted).toContain('3. Third failure');
    });
  });

  describe('DEFAULT_VERIFICATION_CONDITIONS', () => {
    it('should have code_change conditions', () => {
      expect(DEFAULT_VERIFICATION_CONDITIONS.code_change).toBeDefined();
      expect(DEFAULT_VERIFICATION_CONDITIONS.code_change.length).toBeGreaterThan(0);
      
      const hasTestCondition = DEFAULT_VERIFICATION_CONDITIONS.code_change.some(
        (v) => v.type === 'test'
      );
      expect(hasTestCondition).toBe(true);
    });

    it('should have bug_fix conditions', () => {
      expect(DEFAULT_VERIFICATION_CONDITIONS.bug_fix).toBeDefined();
      expect(DEFAULT_VERIFICATION_CONDITIONS.bug_fix.length).toBeGreaterThan(0);
    });

    it('should have feature conditions', () => {
      expect(DEFAULT_VERIFICATION_CONDITIONS.feature).toBeDefined();
      expect(DEFAULT_VERIFICATION_CONDITIONS.feature.length).toBeGreaterThan(0);
    });

    it('should have valid structure for all conditions', () => {
      for (const [key, conditions] of Object.entries(DEFAULT_VERIFICATION_CONDITIONS)) {
        expect(Array.isArray(conditions)).toBe(true);
        
        for (const condition of conditions) {
          expect(condition).toHaveProperty('description');
          expect(condition).toHaveProperty('type');
          expect(condition).toHaveProperty('expectedOutcome');
          expect(typeof condition.description).toBe('string');
          expect(typeof condition.type).toBe('string');
          expect(typeof condition.expectedOutcome).toBe('string');
        }
      }
    });
  });
});
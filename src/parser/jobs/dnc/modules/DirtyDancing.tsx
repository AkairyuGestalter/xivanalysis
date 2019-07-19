// Handle parsing each rotation. Confirm rotations have at least 8 F4 per Convert cycle and 6 F4 per normal cycle (or 5 F4 for non-Heart cycle)
// Flag rotations that do not and list those as warnings

import {t} from '@lingui/macro'
import {Plural, Trans} from '@lingui/react'
import _ from 'lodash'
import React, {Fragment} from 'react'
import {Accordion, Message} from 'semantic-ui-react'

import {ActionLink, StatusLink} from 'components/ui/DbLink'
import Rotation from 'components/ui/Rotation'
import ACTIONS from 'data/ACTIONS'
import STATUSES from 'data/STATUSES'
import {CastEvent, DamageEvent} from 'fflogs'
import Module, {dependency} from 'parser/core/Module'
import CheckList, {Requirement, Rule} from 'parser/core/modules/Checklist'
import Entities from 'parser/core/modules/Entities'
import Invulnerability from 'parser/core/modules/Invulnerability'
import Suggestions, {SEVERITY, Suggestion, TieredSuggestion} from 'parser/core/modules/Suggestions'

const ISSUE_SEVERITY_TIERS = {
	1: SEVERITY.MINOR,
	3: SEVERITY.MEDIUM,
	5: SEVERITY.MAJOR,
}

const STEP_IDS = [
	ACTIONS.STANDARD_STEP.id,
	ACTIONS.TECHNICAL_STEP.id,
]

const DANCE_MOVE_IDS = [
	ACTIONS.ENTRECHAT.id,
	ACTIONS.EMBOITE.id,
	ACTIONS.JETE.id,
	ACTIONS.PIROUETTE.id,
]

const FINISHER_IDS = [
	ACTIONS.STANDARD_FINISH.id,
	ACTIONS.TECHNICAL_FINISH.id,
]

const FINISHER_DAMAGE_IDS = [
	ACTIONS.SINGLE_STANDARD_FINISH.id,
	ACTIONS.DOUBLE_STANDARD_FINISH.id,
	ACTIONS.SINGLE_TECHNICAL_FINISH.id,
	ACTIONS.DOUBLE_TECHNICAL_FINISH.id,
	ACTIONS.TRIPLE_TECHNICAL_FINISH.id,
	ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id,
]

class Dance {
	start: number
	end?: number
	rotation: CastEvent[] = []
	dancing: boolean = false

	public get expectedFinisherId(): number | undefined {
		const danceOpener = _.first(this.rotation)
		if (danceOpener) {
			// The very first action in the opener (after the log starts) should be Standard Finish
			// Check first to see if we started with Technical Step, otherwise assume we started with Standard
			if (danceOpener.ability.guid === ACTIONS.TECHNICAL_STEP.id) {
				return ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id
			}
			return ACTIONS.DOUBLE_STANDARD_FINISH.id
		}
		return
	}

	constructor(start: number) {
		this.start = start
		this.dancing = true
	}
}

export default class DirtyDancing extends Module {
	static handle = 'DirtyDancing'
	static title = t('dng.dirty-dancing.title')`Dance Issues`
	// static displayOrder = DISPLAY_ORDER.ROTATION

	@dependency private checklist!: CheckList
	@dependency private suggestions!: Suggestions
	@dependency private invuln!: Invulnerability
	@dependency private entities!: Entities

	private danceHistory: Dance[] = []
	private missedDances = 0
	private dirtyDances = 0
	private flatFeet = 0

	protected init() {
		this.addHook('cast', {by: 'player', abilityId: STEP_IDS}, this.beginDance)
		this.addHook('cast', {by: 'player', abilityId: DANCE_MOVE_IDS}, this.continueDance)
		this.addHook('cast', {by: 'player', abilityId: FINISHER_IDS}, this.finishDance)
		// This should be aoedamage but ts DamageEvent doesn't support it yet
		this.addHook('damage', {by: 'player', abilityId: FINISHER_DAMAGE_IDS}, this.resolveDance)
		// this.addHook('death', {by: 'player'}, this.onDeath)
		this.addHook('complete', this.onComplete)
	}

	private addDanceToHistory(event: CastEvent) {
		const newDance = new Dance(event.timestamp)
		newDance.rotation.push(event)
		this.danceHistory.push(newDance)
	}

	private beginDance(event: CastEvent) {
		this.addDanceToHistory(event)
	}

	private get lastDance(): Dance | undefined {
		return _.last(this.danceHistory)
	}

	private continueDance(event: CastEvent) {
		const dance = this.lastDance
		if (dance && dance.dancing) {
			dance.rotation.push(event)
		}
	}

	private finishDance(event: CastEvent) {
		const dance = this.lastDance
		if (dance && dance.dancing) {
			dance.rotation.push(event)
		} else {
			this.addDanceToHistory(event)
		}
	}

	private resolveDance(event: DamageEvent) {
		const dance = this.lastDance
		if (dance && dance.dancing) {
			dance.end = event.timestamp
			dance.dancing = false
			// Count dance as dirty if we didn't get the expected finisher
			if (event.ability.guid !== dance.expectedFinisherId) {
				this.dirtyDances++
			}
			// If the finisher didn't hit anything, and something could've been, ding it
			if (event.amount === 0 && !this.invuln.isInvulnerable('all', event.timestamp)) {
				this.missedDances++
			}
			// Dancer messed up if more step actions were recorded than we expected
			const stepCount = dance.rotation.filter(step => STEP_IDS.includes(step.ability.guid)).length
			const expectedCount = dance.expectedFinisherId === ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id ? 4 : 2
			// Only ding if the step count is greater than expected, we're not going to catch the steps in the opener dance
			if (stepCount > expectedCount) {
				this.flatFeet++
			}
		}
	}

	private getStandardFinishUptimePercent() {
		const statusTime = this.entities.getStatusUptime(STATUSES.STANDARD_FINISH.id, this.parser.player.id)
		const uptime = this.parser.fightDuration - this.invuln.getInvulnerableUptime()

		return (statusTime / uptime) * 100
	}

	private onComplete() {
		// Suggest to move closer for finishers.
		if (this.missedDances) {
			this.suggestions.add(new TieredSuggestion({
				icon: ACTIONS.TECHNICAL_FINISH.icon,
				content: <Trans id="dnc.dirty-dancing.suggestions.missed-finishers.content">
					<ActionLink {...ACTIONS.TECHNICAL_FINISH} /> and <ActionLink {...ACTIONS.STANDARD_FINISH} /> are a significant source of damage. Make sure you're in range when finishing a dance.
				</Trans>,
				tiers: ISSUE_SEVERITY_TIERS,
				value: this.missedDances,
				why: <Trans id="dnc.dirty-dancing.suggestions.missed-finishers.why">
					<Plural value={this.missedDances} one="# finish" other="# finishes"/> missed.
				</Trans>,
			}))
		}

		// Suggestion to get all expected finishers
		if (this.dirtyDances) {
			this.suggestions.add(new TieredSuggestion({
				icon: ACTIONS.STANDARD_FINISH.icon,
				content: <Trans id="dnc.dirty-dancing.suggestions.dirty-dances.content">
					Completing fewer steps than expected reduces the damage of your finishes. Make sure you complete the expected number of steps.
				</Trans>,
				tiers: ISSUE_SEVERITY_TIERS,
				value: this.dirtyDances,
				why: <Trans id="dnc.dirty-dancing.suggestions.dirty-dances.why">
					<Plural value={this.dirtyDances} one="# dance" other="# dances"/> finished with missing steps.
				</Trans>,
			}))
		}

		// Suggestion to not faff about with steps
		if (this.flatFeet) {
			this.suggestions.add(new TieredSuggestion({
				icon: ACTIONS.EMBOITE.icon,
				content: <Trans id="dnc.dirty-dancing.suggestions.flat-feet.content">
					Executing the wrong steps leads to a loss of DPS uptime. Make sure to perform your dances correctly.
				</Trans>,
				tiers: ISSUE_SEVERITY_TIERS,
				value: this.flatFeet,
				why: <Trans id="dnc.dirty-dancing.suggestions.flat-feet.why">
					<Plural value={this.flatFeet} one="# dance" other="# dancess"/> finished with extra steps.
				</Trans>,
			}))
		}

		this.checklist.add(new Rule({
			name: <Trans id="dnc.dirty-dancing.checklist.standard-finish-buff.name">Keep your <StatusLink {...STATUSES.STANDARD_FINISH} /> buff up</Trans>,
			description: <Trans id="dnc.dirty-dancing.checklist.standard-finish-buff.description">
				Your <StatusLink {...STATUSES.STANDARD_FINISH} /> buff contributes significantly to your overall damage, and the damage of your <StatusLink {...STATUSES.DANCE_PARTNER} /> as well. Make sure to keep it up at all times.
			</Trans>,
			target: 95,
			requirements: [
				new Requirement({
					name: <Fragment><StatusLink {...STATUSES.STANDARD_FINISH} /> uptime</Fragment>,
					percent: () => this.getStandardFinishUptimePercent(),
				}),
			],
		}))
	}

	output() {
		const panels = this.danceHistory.map(dance => {
			return {
				key: 'title-' + dance.start,
				title: {
					content: <Fragment>
						{this.parser.formatTimestamp(dance.start)}
					</Fragment>,
				},
				content: {
					content: <Rotation events={dance.rotation}/>,
				},
			}
		})

		if (panels.length > 0) {
			return <Fragment>
				<Message>
					<Trans id="dnc.dirty-dancing.accordion.message">
						One of Dancer's primary responsibilities is buffing the party's damage via dances. Each dance also contributes to the Dancer's own damage and should be performed correctly.
					</Trans>
				</Message>
				<Accordion
					exclusive={false}
					panels={panels}
					styled
					fluid
				/>
			</Fragment>
		}
	}
}

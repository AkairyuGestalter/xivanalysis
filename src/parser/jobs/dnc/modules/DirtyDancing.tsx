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
import Suggestions, {SEVERITY, TieredSuggestion} from 'parser/core/modules/Suggestions'
import ErrorMessage from 'components/ui/ErrorMessage';

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
	ACTIONS.SINGLE_STANDARD_FINISH.id,
	ACTIONS.DOUBLE_STANDARD_FINISH.id,
	ACTIONS.TECHNICAL_FINISH.id,
	ACTIONS.SINGLE_TECHNICAL_FINISH.id,
	ACTIONS.DOUBLE_TECHNICAL_FINISH.id,
	ACTIONS.TRIPLE_TECHNICAL_FINISH.id,
	ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id,
]

const EXPECTED_STEP_COUNT = {
	[ACTIONS.STANDARD_STEP.id]: 2,
	[ACTIONS.TECHNICAL_STEP.id]: 4,
}

class Dance {
	start: number
	end?: number
	rotation: CastEvent[] = []
	dancing: boolean = false
	resolved: boolean = false

	dirty: boolean = false
	missed: boolean = false
	extraSteps: boolean = false

	public get error(): boolean {
		return this.dirty || this.missed || this.extraSteps
	}

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
	static handle = 'dirtydancing'
	static title = t('dnc.dirty-dancing.title')`Dance Issues`
	// static displayOrder = DISPLAY_ORDER.ROTATION

	@dependency private checklist!: CheckList
	@dependency private suggestions!: Suggestions
	@dependency private invuln!: Invulnerability
	// Something is up with entities in ts...
	// @dependency private entities!: Entities

	private danceHistory: Dance[] = []
	private missedDances = 0
	private dirtyDances = 0
	private extraSteps = 0

	protected init() {
		this.addHook('cast', {by: 'player', abilityId: STEP_IDS}, this.beginDance)
		this.addHook('cast', {by: 'player'}, this.continueDance)
		this.addHook('cast', {by: 'player', abilityId: FINISHER_IDS}, this.finishDance)
		this.addHook('damage', {by: 'player', abilityId: FINISHER_IDS}, this.resolveDance)
		// this.addHook('death', {by: 'player'}, this.onDeath)
		this.addHook('complete', this.onComplete)
	}

	private addDanceToHistory(event: CastEvent): Dance {
		const newDance = new Dance(event.timestamp)
		newDance.rotation.push(event)
		this.danceHistory.push(newDance)

		return newDance
	}

	private beginDance(event: CastEvent) {
		this.addDanceToHistory(event)
	}

	private get lastDance(): Dance | undefined {
		return _.last(this.danceHistory)
	}

	private continueDance(event: CastEvent) {
		if (!STEP_IDS.includes(event.ability.guid) && !FINISHER_IDS.includes(event.ability.guid)) {
			const dance = this.lastDance
			if (dance && dance.dancing) {
				dance.rotation.push(event)
			}
		}
	}

	private finishDance(event: CastEvent) {
		const dance = this.lastDance
		if (dance && dance.dancing) {
			dance.rotation.push(event)
			dance.dancing = false
		} else {
			this.addDanceToHistory(event)
		}
	}

	private resolveDance(event: DamageEvent) {
		const dance = this.lastDance
		if (dance && !dance.resolved) {

			const finisher = dance.rotation[dance.rotation.length-1]
			dance.end = finisher.timestamp

			// Count dance as dirty if we didn't get the expected finisher
			if (finisher.ability.guid !== dance.expectedFinisherId) {
				dance.dirty = true
			}
			// If the finisher didn't hit anything, and something could've been, ding it.
			// Don't gripe if the boss is invuln, there is use-case for finishing during the downtime
			if (event.amount === 0 && !this.invuln.isInvulnerable('all', finisher.timestamp)) {
				dance.missed = true
			}
			// Dancer messed up if more step actions were recorded than we expected
			const stepCount = dance.rotation.filter(step => DANCE_MOVE_IDS.includes(step.ability.guid)).length
			let expectedCount = 0
			if (dance.expectedFinisherId) {
				expectedCount = EXPECTED_STEP_COUNT[dance.expectedFinisherId]
			}
			// Only ding if the step count is greater than expected, we're not going to catch the steps in the opener dance
			if (stepCount > expectedCount) {
				dance.extraSteps = true
			}

			dance.resolved = true
		}
	}

/*	private getStandardFinishUptimePercent() {
		const statusTime = this.entities.getStatusUptime(STATUSES.STANDARD_FINISH.id, this.parser.player.id)
		const uptime = this.parser.fightDuration - this.invuln.getInvulnerableUptime()

		return (statusTime / uptime) * 100
	}
*/
	private onComplete() {
		this.missedDances = this.danceHistory.filter(dance => dance.missed).length
		this.dirtyDances = this.danceHistory.filter(dance => dance.dirty).length
		this.extraSteps = this.danceHistory.filter(dance => dance.extraSteps).length

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
					Performing fewer steps than expected reduces the damage of your finishes. Make sure you perform the expected number of steps.
				</Trans>,
				tiers: ISSUE_SEVERITY_TIERS,
				value: this.dirtyDances,
				why: <Trans id="dnc.dirty-dancing.suggestions.dirty-dances.why">
					<Plural value={this.dirtyDances} one="# dance" other="# dances"/> finished with missing steps.
				</Trans>,
			}))
		}

		// Suggestion to not faff about with steps
		if (this.extraSteps) {
			this.suggestions.add(new TieredSuggestion({
				icon: ACTIONS.EMBOITE.icon,
				content: <Trans id="dnc.dirty-dancing.suggestions.extra-steps.content">
					Performing the wrong steps makes your dance take longer and leads to a loss of DPS uptime. Make sure to perform your dances correctly.
				</Trans>,
				tiers: ISSUE_SEVERITY_TIERS,
				value: this.extraSteps,
				why: <Trans id="dnc.dirty-dancing.suggestions.extra-steps.why">
					<Plural value={this.extraSteps} one="# dance" other="# dances"/> finished with extra steps.
				</Trans>,
			}))
		}

/*		this.checklist.add(new Rule({
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
	*/
	}

	output() {
		const panels = this.danceHistory.filter(dance => dance.error).map(dance => {
			return {
				key: 'title-' + dance.end,
				title: {
					content: <Fragment>
						{this.parser.formatTimestamp(dance.end || 0)}
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
						One of Dancer's primary responsibilities is buffing the party's damage via dances.<br />
						Each dance also contributes to the Dancer's own damage and should be performed correctly.
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

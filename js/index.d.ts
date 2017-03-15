/// <reference types="node" />
/// <reference types="es6-promise" />
import * as events from "events";
import { IWorker, IAutoScalableGrid, IAutoScalerImplementation, IWorkersLaunchRequest, LaunchingWorker, TerminatingWorker, IGridAutoScalerJSON } from 'autoscalable-grid';
export interface Options {
    EnabledAtStart?: boolean;
    MaxWorkersCap?: number;
    MinWorkersCap?: number;
    LaunchingTimeoutMinutes?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
    RampUpSpeedRatio?: number;
}
export declare class GridAutoScaler extends events.EventEmitter {
    private scalableGrid;
    private implementation;
    private __PollingIntervalMS;
    private __enabled;
    private __MaxWorkersCap;
    private __MinWorkersCap;
    private __LaunchingTimeoutMinutes;
    private __TerminateWorkerAfterMinutesIdle;
    private __RampUpSpeedRatio;
    private __launchingWorkers;
    static MIN_POLLING_INTERVAL_MS: number;
    static MIN_MAX_WORKERS_CAP: number;
    static MIN_MIN_WORKERS_CAP: number;
    static MIN_LAUNCHING_TIMEOUT_MINUTES: number;
    static MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE: number;
    static MIN_RAMP_UP_SPEED_RATIO: number;
    static MAX_RAMP_UP_SPEED_RATIO: number;
    constructor(scalableGrid: IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    private boundValue(value, min, max?);
    readonly Grid: IAutoScalableGrid;
    readonly Implementation: IAutoScalerImplementation;
    readonly ScalingUp: boolean;
    readonly LaunchingWorkers: LaunchingWorker[];
    Enabled: boolean;
    readonly HasMaxWorkersCap: boolean;
    MaxWorkersCap: number;
    readonly HasMinWorkersCap: boolean;
    MinWorkersCap: number;
    LaunchingTimeoutMinutes: number;
    TerminateWorkerAfterMinutesIdle: number;
    RampUpSpeedRatio: number;
    private getWorkerFromState(state);
    private upScale(launchRequest);
    private downScale(toBeTerminatedWorkers);
    private onUpScalingComplete(launchingWorker);
    private onDownScalingComplete(terminatingWorkers);
    launchNewWorkers(launchRequest: IWorkersLaunchRequest): Promise<LaunchingWorker[]>;
    terminateWorkers(workers: IWorker[]): Promise<TerminatingWorker[]>;
    private computeAutoDownScalingWorkers(state);
    private computeAutoUpScalingLaunchRequest(state);
    private autoDownScaling(state);
    private autoUpScaling(state);
    private satisfyAutoDownScalingCondition(state);
    private satisfyAutoUpScalingCondition(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationConfigUrl: Promise<string>;
    toJSON(): IGridAutoScalerJSON;
}

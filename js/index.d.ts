/// <reference types="es6-promise" />
/// <reference types="node" />
import * as events from "events";
import * as asg from 'autoscalable-grid';
export declare type WorkerKey = string;
export interface IWorkersLaunchRequest {
    NumInstance: number;
    Hint?: any;
}
export interface IAutoScalerImplementation {
    TranslateToWorkerKeys: (workerIdentifiers: asg.WorkerIdentifier[]) => Promise<WorkerKey[]>;
    ComputeWorkersLaunchRequest: (state: asg.IAutoScalableState) => Promise<IWorkersLaunchRequest>;
    Launcher: (launchRequest: IWorkersLaunchRequest) => Promise<WorkerKey[]>;
    Terminator: (workerKeys: WorkerKey[]) => Promise<any>;
    readonly ConfigUrl: Promise<string>;
}
export interface Options {
    EnabledAtStart?: boolean;
    MaxAllowedWorkers?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}
export interface IGridAutoScalerJSON {
    Scaling: boolean;
    Enabled: boolean;
    HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    LaunchingWorkers: WorkerKey[];
    TerminatingWorkers: WorkerKey[];
}
export declare class GridAutoScaler extends events.EventEmitter {
    private scalableGrid;
    private implementation;
    private options;
    private __enabled;
    private __MaxAllowedWorkers;
    private __terminatingWorkers;
    private __launchingWorkers;
    constructor(scalableGrid: asg.IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    readonly Scaling: boolean;
    readonly LaunchingWorkers: WorkerKey[];
    readonly TerminatingWorkers: WorkerKey[];
    Enabled: boolean;
    readonly HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    private getTerminatePromise(toBeTerminatedWorkers);
    private getDownScalingPromise(state);
    private getUpScalingWithTaskDebtPromise(state);
    private getUpScalingPromise(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationConfigUrl: Promise<string>;
    toJSON(): IGridAutoScalerJSON;
}

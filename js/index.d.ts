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
    TranslateToWorkerKeys: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    ComputeWorkersLaunchRequest: (state: asg.IAutoScalableState) => Promise<IWorkersLaunchRequest>;
    LaunchInstances: (launchRequest: IWorkersLaunchRequest) => Promise<WorkerKey[]>;
    TerminateInstances: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    getConfigUrl: () => Promise<string>;
}
export interface Options {
    EnabledAtStart?: boolean;
    MaxWorkersCap?: number;
    MinWorkersCap?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}
export declare type ScalingState = "Idle" | "ScalingUp" | "ScalingDown";
export interface IGridAutoScalerJSON {
    Scaling: boolean;
    ScalingState: ScalingState;
    Enabled: boolean;
    HasMaxWorkersCap: boolean;
    MaxWorkersCap: number;
    HasMinWorkersCap: boolean;
    MinWorkersCap: number;
    LaunchingWorkers: WorkerKey[];
    TerminatingWorkers: WorkerKey[];
}
export interface IGridAutoScaler {
    isScaling: () => Promise<boolean>;
    isEnabled: () => Promise<boolean>;
    hasWorkersCap: () => Promise<boolean>;
    enable: () => Promise<any>;
    disable: () => Promise<any>;
    getMaxWorkersCap: () => Promise<number>;
    setMaxWorkersCap: (value: number) => Promise<number>;
    getMinWorkersCap: () => Promise<number>;
    setMinWorkersCap: (value: number) => Promise<number>;
    getLaunchingWorkers: () => Promise<WorkerKey[]>;
    getTerminatingWorkers: () => Promise<WorkerKey[]>;
    getJSON: () => Promise<IGridAutoScalerJSON>;
    getImplementationConfigUrl: () => Promise<string>;
}
export declare class GridAutoScaler extends events.EventEmitter {
    private scalableGrid;
    private implementation;
    private options;
    private __enabled;
    private __MaxWorkersCap;
    private __MinWorkersCap;
    private __terminatingWorkers;
    private __launchingWorkers;
    constructor(scalableGrid: asg.IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    readonly Scaling: boolean;
    readonly LaunchingWorkers: WorkerKey[];
    readonly TerminatingWorkers: WorkerKey[];
    readonly ScalingState: ScalingState;
    Enabled: boolean;
    readonly HasMaxWorkersCap: boolean;
    MaxWorkersCap: number;
    readonly HasMinWorkersCap: boolean;
    MinWorkersCap: number;
    private getWorkerFromState(state);
    private getDownScalingPromise(state);
    private getUpScalingWithTaskDebtPromise(state);
    private getUpScalingPromise(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationConfigUrl: Promise<string>;
    toJSON(): IGridAutoScalerJSON;
}
